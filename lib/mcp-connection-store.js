// Owner-scoped remote records and project-scoped computer preferences with encrypted credentials; never sent to the UI.
var fs = require('fs');
var path = require('path');
var crypto = require('crypto');
var equal = require('util').isDeepStrictEqual;

function createConnectionStore(root, project, options) {
  var directory = path.join(root, 'mcp-connections');
  var shared = !!(options && options.shared);
  function scope(owner) {
    if (typeof owner !== 'string' || !owner || owner.length > 160) throw new Error('MCP account owner is required.');
    return shared ? JSON.stringify([owner]) : JSON.stringify([project, owner]);
  }
  function filename(owner) { return path.join(directory, crypto.createHash('sha256').update(scope(owner)).digest('hex') + '.json'); }
  function legacyFilename(owner) { return path.join(directory, crypto.createHash('sha256').update(JSON.stringify([project, owner])).digest('hex') + '.json'); }
  function key() {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    var file = path.join(directory, '.key'), bytes;
    try { bytes = fs.readFileSync(file); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      var temp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
      try {
        fs.writeFileSync(temp, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 });
        try { fs.linkSync(temp, file); } catch (publishError) { if (publishError.code !== 'EEXIST') throw publishError; }
      } finally { fs.unlinkSync(temp); }
      bytes = fs.readFileSync(file);
    }
    if (bytes.length !== 32) throw new Error('MCP encryption key is invalid.');
    return bytes;
  }
  function decode(file, aad) {
    var data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { records: [], revision: null, migratedProjects: [], retired: [] }; throw new Error('Could not read MCP connections.'); }
    var parts = data.encrypted.split('.').map(function (part) { return Buffer.from(part, 'base64'); });
    var cipher = crypto.createDecipheriv('aes-256-gcm', key(), parts[0]);
    cipher.setAAD(Buffer.from(aad)); cipher.setAuthTag(parts[1]);
    var value = JSON.parse(Buffer.concat([cipher.update(parts[2]), cipher.final()]).toString('utf8'));
    if (Array.isArray(value)) return { records: value, revision: null, migratedProjects: [], retired: [] };
    return { records: Array.isArray(value.records) ? value.records : [], revision: value.revision || null, migratedProjects: Array.isArray(value.migratedProjects) ? value.migratedProjects : [], retired: value.retired || [] };
  }
  function encode(owner, state, expectedRevision) {
    var current = decode(filename(owner), scope(owner));
    if (expectedRevision !== undefined && current.revision !== expectedRevision) throw new Error('MCP connections changed. Please retry.');
    var next = { records: state.records, revision: crypto.randomBytes(16).toString('hex'), migratedProjects: state.migratedProjects || [], retired: state.retired || [] };
    var iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
    cipher.setAAD(Buffer.from(scope(owner)));
    var bytes = Buffer.concat([cipher.update(JSON.stringify(next), 'utf8'), cipher.final()]);
    var value = { encrypted: [iv, cipher.getAuthTag(), bytes].map(function (part) { return part.toString('base64'); }).join('.') };
    var file = filename(owner), temp = file + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
    try { fs.writeFileSync(temp, JSON.stringify(value), { mode: 0o600 }); fs.renameSync(temp, file); }
    finally { try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    return next.revision;
  }
  function visible(records) { if (!shared) return records; return records.filter(function (record) { return record.source !== 'computer' || record.project === project; }); }
  function connectionConflict(left, right) { return left.id && left.id === right.id || (left.url && right.url && left.url === right.url); }
  function migrate(owner, state) {
    if (!shared || state.migratedProjects.indexOf(project) >= 0) return state;
    var legacy = decode(legacyFilename(owner), JSON.stringify([project, owner])).records;
    var merged = state.records.slice();
    legacy.forEach(function (record) {
      var copy = Object.assign({}, record);
      if (copy.source === 'computer') copy.project = project;
      else if ((state.retired || []).some(function (removed) { return connectionConflict(removed, copy); })) return;
      var existing = merged.filter(function (current) { return current.source === copy.source && (copy.source === 'computer' ? current.project === project && current.name === copy.name : connectionConflict(current, copy)); });
      if (existing.length && existing.some(function (current) { return !equal(current, copy); })) throw new Error('MCP connection migration conflict. Resolve the legacy project connection before retrying.');
      if (!existing.length) merged.push(copy);
    });
    state.records = merged;
    state.migratedProjects = state.migratedProjects.concat([project]);
    return state;
  }
  function readUnlocked(owner) {
    var state = decode(filename(owner), scope(owner));
    if (shared) {
      var unique = [];
      state.records.forEach(function (record) {
        var existing = unique.find(function (current) {
          return record.source === 'computer' ? current.source === 'computer' && record.project === current.project && record.name === current.name : current.source !== 'computer' && connectionConflict(record, current);
        });
        if (existing && !equal(existing, record)) throw new Error('Conflicting duplicate MCP records require resolution.');
        if (!existing) unique.push(record);
      });
      if (unique.length !== state.records.length) { state.records = unique; state.revision = encode(owner, state, state.revision); }
    }
    if (shared && state.migratedProjects.indexOf(project) < 0) { state = migrate(owner, state); state.revision = encode(owner, state, state.revision); }
    return state;
  }
  // Fail closed on contention. The lock covers migration and the full CAS read/write,
  // including callers in a second process using the same storage root.
  function locked(owner, operation) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    var file = filename(owner) + '.lock', fd;
    try { fd = fs.openSync(file, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('MCP connections are busy. Please retry.'); throw error; }
    try { fs.writeFileSync(fd, String(process.pid)); return operation(); }
    finally { fs.closeSync(fd); fs.unlinkSync(file); }
  }
  function snapshot(owner) {
    return locked(owner, function () {
      var state = readUnlocked(owner);
      return { records: visible(state.records), revision: state.revision };
    });
  }
  function load(owner) { return snapshot(owner).records; }
  function revision(owner) { return snapshot(owner).revision; }
  function validate(records) {
    if (!Array.isArray(records)) throw new Error('MCP connection snapshot must be an array.');
    records.forEach(function (record, index) {
      if (!record || typeof record !== 'object') throw new Error('Invalid MCP connection record.');
      if (records.slice(0, index).some(function (previous) {
        return record.id && previous.id === record.id ||
          record.source === 'computer' && previous.source === 'computer' && record.name === previous.name ||
          record.source !== 'computer' && previous.source !== 'computer' && record.url && record.url === previous.url;
      })) throw new Error('Duplicate MCP connection in snapshot.');
      if (shared && record.source === 'computer' && record.project && record.project !== project) throw new Error('Foreign project computer preference.');
    });
  }
  // Remote rows are the complete owner snapshot. Computer rows replace only this
  // project's preferences; omitted remote rows are deleted, never merged back.
  function save(owner, records, expectedRevision) {
    validate(records);
    return locked(owner, function () {
      var state = readUnlocked(owner);
      if (expectedRevision !== undefined && state.revision !== expectedRevision) throw new Error('MCP connections changed. Please retry.');
      if (!shared) return encode(owner, { records: records, migratedProjects: [] }, state.revision);
      var incomingRemote = records.filter(function (record) { return record.source !== 'computer'; });
      var currentComputer = records.filter(function (record) { return record.source === 'computer'; }).map(function (record) { return Object.assign({}, record, { project: project }); });
      var otherComputer = state.records.filter(function (record) { return record.source === 'computer' && record.project !== project; });
      var removed = state.records.filter(function (record) {
        return record.source !== 'computer' && !incomingRemote.some(function (incoming) { return connectionConflict(record, incoming); });
      }).map(function (record) { return { id: record.id, url: record.url }; });
      state.retired = (state.retired || []).concat(removed).filter(function (record, index, all) {
        return all.findIndex(function (other) { return other.id === record.id && other.url === record.url; }) === index;
      });
      state.records = incomingRemote.concat(otherComputer, currentComputer);
      return encode(owner, state, state.revision);
    });
  }
  return { load: load, save: save, revision: revision, snapshot: snapshot, namespace: fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root) };
}
module.exports = { createConnectionStore: createConnectionStore };
