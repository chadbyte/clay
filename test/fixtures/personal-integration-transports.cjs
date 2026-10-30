// Synthetic transports are installed after HOME isolation and before server imports.
var linear = require('../../lib/linear-api'), email = require('../../lib/email-accounts');
var held = [], delay = false, failLinear = false, failEmail = false, failEmailSave = false;
linear.query = function () {
  return new Promise(function (resolve, reject) {
    function finish() { if (failLinear) reject(new Error('Synthetic Linear failure')); else resolve({organization:{id:'fixture-workspace',name:'Fixture workspace',urlKey:'fixture'}}); }
    if (delay) held.push(finish); else finish();
  });
};
email.testConnection = function () {
  return new Promise(function (resolve) {
    function finish() { resolve({ok:!failEmail,imap:{ok:!failEmail,error:'Synthetic mailbox failure'},smtp:{ok:!failEmail,error:'Synthetic mailbox failure'}}); }
    if (delay) held.push(finish); else finish();
  });
};
var add = email.addAccount;
email.addAccount = function () { return failEmailSave ? {error:'Synthetic email storage failure'} : add.apply(email,arguments); };
// Polling and context reads must also stay offline for the saved synthetic mailbox.
var imapFile = require.resolve('imapflow');
require.cache[imapFile] = {id:imapFile,filename:imapFile,loaded:true,exports:{ImapFlow:function () {
  this.connect=function () {return Promise.reject(new Error('Fixture mailbox transport disabled'));}; this.close=function () {};
}}};
email.addAccount('admin',{email:'saved@example.invalid',provider:'gmail',appPassword:'synthetic-mailbox-password'});
module.exports = {handle:function (req,res) {
  if (!req.url.startsWith('/__fixture/integrations')) return false;
  var query = new URL(req.url,'http://fixture.invalid').searchParams;
  if (query.has('delay')) delay = query.get('delay') === 'true';
  if (query.has('failLinear')) failLinear = query.get('failLinear') === 'true';
  if (query.has('failEmail')) failEmail = query.get('failEmail') === 'true';
  if (query.has('failEmailSave')) failEmailSave = query.get('failEmailSave') === 'true';
  if (query.has('release')) { delay = false; held.splice(0).forEach(function (finish) { finish(); }); }
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({pending:held.length}));return true;
}};
