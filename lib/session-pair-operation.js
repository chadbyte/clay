function fingerprint(args, fields) {
  var source = args || {};
  var value = {};
  for (var i = 0; i < fields.length; i++) {
    var name = fields[i];
    value[name] = Object.prototype.hasOwnProperty.call(source, name) ? source[name] : null;
  }
  return JSON.stringify(value);
}

module.exports = { fingerprint: fingerprint };
