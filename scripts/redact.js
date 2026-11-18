// Server-side secret redaction (#226): everything termdeck writes to disk or posts out passes through here.
// TD_REDACT=0 turns it off. The patterns live in public/js/redact.js so Save output in the browser uses the same ones.
const { redactSecrets } = require('../public/js/redact.js');
module.exports = { redact: (s) => (process.env.TD_REDACT === '0' || typeof s !== 'string' ? s : redactSecrets(s)) };
