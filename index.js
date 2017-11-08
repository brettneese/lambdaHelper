// lambdaHandler.js
'use strict';
process.title = 'crapi';

var express = require('express');
var app = express();
var cls = require('continuation-local-storage');
var expressWinston = require('express-winston');
var isTruthy = require('env-is-truthy');
var serverless = require('serverless-http');
var clsify = require('cls-middleware');
var log = require('@hbkapps/logger')(__filename);

function createOrGetNamespace(nsName){
  var ns = cls.getNamespace(nsName);

  if(!ns){
    ns = cls.createNamespace(nsName);
  }

  return ns;
}

exports.createHandler = function(router){
  app.use(clsify(createOrGetNamespace('transaction')));
  app.use(
    expressWinston.logger({
      winstonInstance: log,
      expressFormat: true
    })
  );
  app.use(router.routerPath, router);
  app.use(
    expressWinston.errorLogger({
      winstonInstance: log
    })
  );

  var isOffline = isTruthy(process.env.IS_OFFLINE);
  var awsExecutionEnv = process.env.AWS_EXECUTION_ENV;
  var isCi = isTruthy(process.env.CI);

  log.info('We are' + (isOffline ? ' ' : ' not ') + 'offline');
  log.info(
    'AWS Execution environment is: ' +
      (awsExecutionEnv ? awsExecutionEnv : '<not set>')
  );
  log.info(
    'Detected that we are' + (isCi ? ' ' : ' not ') + 'running under CI'
  );

  // if we're not running on CIin lambda or a lambda-like environment, return the handler
  /*
  * we want to use the proxy if and only if
  * - we are *not* running unit tests - we know unit tests are happening when isOffline is false. awsExecutionEnv will be set when running on CI but not when running locally. so we want to ensure that isOffline is true while awsExecutionEnv and isCI are set or while awsExecutionEnv and isCI are not set. However, since CI uses the Lambda build image, we know isCI <-> awsExecutionEnv. So we want to run when (isOffline && (isCI || !isCI))
  * - we are running integration tests - we know integration tests are happening when isOffline is true, giving us (isOffline && (isCI || !isCI)) || isOffline
  * - we are actually deployed to lambda, in which case isCi and isOffline should both be false while awsExecutionEnv exists, giving us (isOffline && (isCI || !isCI)) || isOffline || (!isOffline && !isCI && awsExecutionEnv)
  *
  * just trust the author that that simplifies to the expression we use below.
  * */
  if(isOffline || (!isCi && awsExecutionEnv)){
    log.info('API module will proxy through AWS Serverless Express');
    var slsApp = serverless(app, {
      binary: function(headers, options){
        return headers['x-override-encoding'] == 'Base64';
      }
    });

    return createOrGetNamespace('transaction').bind(function(evt, ctx, cb){
      var ns = cls.getNamespace('transaction');

      log.silly('Lambda event', evt);
      log.silly('Lambda context:', ctx);

      if(evt.requestContext && evt.requestContext.requestId){
        ns.set('AWS_APIG_REQUEST_ID', evt.requestContext.requestId);
      }

      if(ctx && ctx.awsRequestId){
        ns.set('AWS_LAMBDA_REQUEST_ID', ctx.awsRequestId);
      }

      return slsApp(evt, ctx, cb);
    });
  }

  // otherwise start an express server
  log.info('API module preparing to listen on port 8001');
  app.listen(8001, function(){
    log.info('API module listening on port 8001');
  });
};