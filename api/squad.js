// Dispatch Squad checkout, confirmation, webhook, status, cancellation, and renewal requests through one Vercel function.
const handlers = {
  cancel: require('./_squad-cancel'),
  checkout: require('./_squad-checkout'),
  confirm: require('./_squad-confirm'),
  renewals: require('./_squad-renewals'),
  status: require('./_squad-status'),
  webhook: require('./_squad-webhook')
};

module.exports = function handler(req, res) {
  const action = req.query && req.query.action;
  const route = handlers[action];
  if (!route) return res.status(404).json({ error: 'not_found' });
  return route(req, res);
};
