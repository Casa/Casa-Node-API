/* eslint-disable max-len,id-length */
/* globals requester, reset */
const sinon = require('sinon');
const LndError = require('../../../../models/errors.js').LndError;
const lndMocks = require('../../../mocks/lnd.js');

describe('v1/lnd/channel endpoints', () => {
  let token;

  before(async() => {
    reset();

    token = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6InRlc3QtdXNlciIsImlhdCI6MTU3NTIyNjQxMn0.N06esl2dhN1mFqn-0o4KQmmAaDW9OsHA39calpp_N9B3Ig3aXWgl064XAR9YVK0qwX7zMOnK9UrJ48KUZ-Sb4A';
  });

  describe('/estimateFee GET', function() {
    let lndEstimateFee;
    let lndGenerateAddress;
    let lndUnspentUtxos;
    let lndWalletBalance;

    afterEach(() => {
      lndEstimateFee.restore();
      lndGenerateAddress.restore();

      if (lndUnspentUtxos) {
        lndUnspentUtxos.restore();
      }

      if (lndWalletBalance) {
        lndWalletBalance.restore();
      }
    });

    it('should return a fee estimate', done => {

      const estimateFee = lndMocks.getEstimateFee();
      const generateAddress = lndMocks.generateAddress();

      lndEstimateFee = sinon.stub(require('../../../../services/lnd.js'), 'estimateFee')
        .resolves(estimateFee);
      lndGenerateAddress = sinon.stub(require('../../../../services/lnd.js'), 'generateAddress')
        .resolves(generateAddress);

      requester
        .get('/v1/lnd/channel/estimateFee?amt=100000&confTarget=1')
        .set('authorization', `JWT ${token}`)
        .end((err, res) => {
          if (err) {
            done(err);
          }
          res.should.have.status(200);
          res.should.be.json;
          res.body.should.not.have.property('fast');
          res.body.should.not.have.property('normal');
          res.body.should.not.have.property('slow');
          res.body.should.not.have.property('cheapest');
          res.body.should.have.property('feeSat');
          res.body.should.have.property('feerateSatPerByte');

          done();
        });
    });

    it('should return a fee estimate, group', done => {

      const estimateFee = lndMocks.getEstimateFee();
      const generateAddress = lndMocks.generateAddress();

      lndEstimateFee = sinon.stub(require('../../../../services/lnd.js'), 'estimateFee')
        .resolves(estimateFee);
      lndGenerateAddress = sinon.stub(require('../../../../services/lnd.js'), 'generateAddress')
        .resolves(generateAddress);

      requester
        .get('/v1/lnd/channel/estimateFee?amt=100000&confTarget=0')
        .set('authorization', `JWT ${token}`)
        .end((err, res) => {
          if (err) {
            done(err);
          }
          res.should.have.status(200);
          res.should.be.json;
          res.body.should.have.property('fast');
          res.body.fast.should.have.property('feeSat');
          res.body.fast.should.have.property('feerateSatPerByte');
          res.body.should.have.property('normal');
          res.body.normal.should.have.property('feeSat');
          res.body.normal.should.have.property('feerateSatPerByte');
          res.body.should.have.property('slow');
          res.body.slow.should.have.property('feeSat');
          res.body.slow.should.have.property('feerateSatPerByte');
          res.body.should.have.property('cheapest');
          res.body.cheapest.should.have.property('feeSat');
          res.body.cheapest.should.have.property('feerateSatPerByte');

          done();
        });
    });

    it('should return insufficient funds', done => {

      const generateAddress = lndMocks.generateAddress();

      lndEstimateFee = sinon.stub(require('../../../../services/lnd.js'), 'estimateFee')
        .throws(new LndError('Unable to estimate fee request', {details: 'insufficient funds available to construct transaction'}));
      lndGenerateAddress = sinon.stub(require('../../../../services/lnd.js'), 'generateAddress')
        .resolves(generateAddress);

      requester
        .get('/v1/lnd/channel/estimateFee?amt=100000&confTarget=1')
        .set('authorization', `JWT ${token}`)
        .end((err, res) => {
          if (err) {
            done(err);
          }
          res.should.have.status(200);
          res.should.be.json;
          res.body.should.have.property('code');
          res.body.code.should.equal('INSUFFICIENT_FUNDS');
          res.body.should.have.property('text');
          res.body.text.should.equal('Lower amount or increase confirmation target.');

          done();
        });
    });

    it('should return output is dust', done => {

      const generateAddress = lndMocks.generateAddress();

      lndEstimateFee = sinon.stub(require('../../../../services/lnd.js'), 'estimateFee')
        .throws(new LndError('Unable to estimate fee request', {details: 'transaction output is dust'}));
      lndGenerateAddress = sinon.stub(require('../../../../services/lnd.js'), 'generateAddress')
        .resolves(generateAddress);

      requester
        .get('/v1/lnd/channel/estimateFee?amt=100000&confTarget=1')
        .set('authorization', `JWT ${token}`)
        .end((err, res) => {
          if (err) {
            done(err);
          }
          res.should.have.status(200);
          res.should.be.json;
          res.body.should.have.property('code');
          res.body.code.should.equal('OUTPUT_IS_DUST');
          res.body.should.have.property('text');
          res.body.text.should.equal('Transaction output is dust.');

          done();
        });
    });

  });

});
