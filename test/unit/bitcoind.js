/* globals assert */
/* eslint-disable max-len */

const proxyquire = require('proxyquire');
const bitcoindMocks = require('../mocks/bitcoind.js');

describe('bitocindLogic', function() {

  describe('getExternalIp', function() {

    it('should return an ipv4 address', function(done) {

      const peerInfo = bitcoindMocks.getPeerInfo();

      const ipv4 = '10.11.12.13';
      const port = '10000';
      peerInfo.result[0].addrlocal = ipv4 + ':' + port;

      const bitcoindServiceStub = {
        'services/bitcoind.js': {
          getPeerInfo: () => Promise.resolve(peerInfo)
        }
      };

      const bitcoindLogic = proxyquire('logic/bitcoind.js', bitcoindServiceStub);

      bitcoindLogic.getExternalIP().then(function(response) {
        assert.equal(response.externalIP, ipv4);

        done();
      });
    });

    it('should return an ipv6 address', function(done) {

      const peerInfo = bitcoindMocks.getPeerInfo();

      const ipv6 = '566f:2401:22be:9a6d:23ef:2558:5545:b3fe';
      const port = '10000';
      peerInfo.result[0].addrlocal = ipv6 + ':' + port;

      const bitcoindServiceStub = {
        'services/bitcoind.js': {
          getPeerInfo: () => Promise.resolve(peerInfo)
        }
      };

      const bitcoindLogic = proxyquire('logic/bitcoind.js', bitcoindServiceStub);

      bitcoindLogic.getExternalIP().then(function(response) {
        assert.equal(response.externalIP, ipv6);

        done();
      });
    });

  });
});
