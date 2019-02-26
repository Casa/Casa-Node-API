const bitcoindService = require('services/bitcoind.js');
const bashService = require('services/bash.js');

async function getExternalIP() {

  const peerInfo = (await bitcoindService.getPeerInfo()).result;

  let externalIP;
  if (peerInfo.length === 0) {
    externalIP = await getExternalIPFromIPInfo();
  } else {
    externalIP = getMostValidatedIP(peerInfo);
  }

  return {externalIP: externalIP}; // eslint-disable-line object-shorthand
}

async function getExternalIPFromIPInfo() {

  const options = {};

  // use ipinfo.io to get ip address if unable to from peers
  const data = await bashService.exec('curl', ['https://ipinfo.io/ip'], options);

  // clean return characters
  return data.out.replace(/[^a-zA-Z0-9 .:]/g, '');
}

function getMostValidatedIP(peerInfo) {
  const peerCount = {};
  const mostValidatedExternalIp = {
    count: 0,
    externalIP: 'UNKNOWN'
  };

  for (const peer of peerInfo) {

    // Make sure addrlocal exists, sometimes peers don't supply it
    if (Object.prototype.hasOwnProperty.call(peer, 'addrlocal')) {

      // Use the semi colon to account for ipv4 and ipv6
      const semi = peer.addrlocal.lastIndexOf(':');
      const externalIP = peer.addrlocal.substr(0, semi);

      // Ignore localhost, this is incorrect data from bitcoind
      if (externalIP !== '127.0.0.1') {

        // Increment the count for this external ip
        if (Object.prototype.hasOwnProperty.call(peerCount, externalIP)) {
          peerCount[externalIP]++;
        } else {
          peerCount[externalIP] = 1;
        }

        // Set the most validated external ip
        if (peerCount[externalIP] > mostValidatedExternalIp.count) {
          mostValidatedExternalIp.count = peerCount[externalIP];
          mostValidatedExternalIp.externalIP = externalIP;
        }
      }
    }
  }

  return mostValidatedExternalIp.externalIP;
}

module.exports = {
  getExternalIP,
};
