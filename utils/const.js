/* eslint-disable id-length */
module.exports = {
  LN_REQUIRED_CONFIRMATIONS: 3,
  MANAGED_CHANNELS_FILE: '/channel-data/managedChannels.json',
  REQUEST_CORRELATION_NAMESPACE_KEY: 'lnapi-request',
  REQUEST_CORRELATION_ID_KEY: 'reqId',
  JWT_PUBLIC_KEY: process.env.JWT_PUBLIC_KEY || 'UNKNOWN',
};
