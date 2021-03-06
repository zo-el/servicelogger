const path = require('path')
const { Config, Conductor, Scenario } = require('../../holochain-rust/nodejs_conductor')
Scenario.setTape(require('tape'))

const dnaPath = path.join(__dirname, "../dist/servicelogger.dna.json")
const dna = Config.dna(dnaPath, 'servicelogger')
const agentApp = Config.agent("app")
const appInstance = Config.instance(agentApp, dna)


// WARNING: you need to place a 'holofuel.dna.json' file into the /dist folder (created by packaging the holofuel app)
// https://github.com/Holo-Host/holofuel/
const fuelPath = path.join(__dirname, "../dist/holofuel.dna.json")
const fuelDna = Config.dna(fuelPath, 'holofuel')
const fuelApp= Config.agent("fuel")

const fuelInstance = Config.instance(fuelApp, fuelDna)

const scenario = new Scenario([appInstance, fuelInstance], { debugLog: true })

// Basic agentId check
scenario.runTape('agentId', async (t, { app }) => {
  t.ok(app.agentId)
})

const payment_prefs = {
  provider_address: "QmUMwQthHNKSjoHpvxtxPPMA8qiMNytwBQEgVXHXjZvZRb",
  dna_bundle_hash: "QmfAzihC8RVNLCwtDeeUH8eSAACweFq77KBK4e1bJWmU8A",
  max_fuel_per_invoice: 1.0,
  max_unpaid_value: 2.0,
}

const sample_request = {
  agent_id: "QmUMwQthHNKSjoHpvxtxPPMA8qiMNytwBQEgVXHXjZvZRb",
  zome_call_spec: "blog/create_post",
  dna_hash: "QmfAzihC8RVNLCwtDeeUH8eSAACweFq77KBK4e1bJWmU8A",
  client_signature: "QmXsSgDu7NNdAq7F9rmmHSaRz79a8njtkaYgRqxzz1taKk",
}

const sample_response1 = {
  request_hash: "QmVtcYog4isPhcurmZxkggnCnoKVdAmb97VZy6Th6aV1x4",
  hosting_stats: {
    cpu_seconds: 3.2,
    bytes_in: 12309,
    bytes_out: 7352,
  },
  response_data_hash: "QmVtcYog4isPhcurmZxkggnCnoKVdAmb97VZy6Th6aV1xv",
  response_log: '64.242.88.10 - - [07/Mar/2004:16:11:58 -0800] "GET /twiki/bin/view/TWiki/WikiSyntax HTTP/1.1" 200 7352',
  host_signature: "QmXsSgDu7NNdAq7F9rmmHSaRz79a8njtkaYgRqxzz1taKk"
}

const sample_response2 = {
  request_hash: "QmVtcYog4isPhcurmZxkggnCnoKVdAmb97VZy6Th6aV1x4",
  hosting_stats: {
    cpu_seconds: 3.3,
    bytes_in: 4332,
    bytes_out: 7352,
  },
  response_log: '64.242.88.10 - - [07/Mar/2004:16:11:58 -0800] "GET /twiki/bin/view/TWiki/WikiSyntax HTTP/1.1" 200 7352',
  host_signature: "QmXsSgDu7NNdAq7F9rmmHSaRz79a8njtkaYgRqxzz1taKk"
}


// 1. The client starts a new request for hosting, based on a call from the HC Interceptor
scenario.runTape('can log a client request', async (t, { app }) => {

  const addr = app.call("service", "log_request", {"entry" : sample_request})

  t.deepEqual(addr.Ok, "QmVtcYog4isPhcurmZxkggnCnoKVdAmb97VZy6Th6aV1x4")

  const result = app.call("service", "get_request", {"address": addr.Ok})

  t.deepEqual(result, { Ok: { App: [ 'client_request', JSON.stringify(sample_request) ] } })
})

// 2. The Conductor wants to record a HostResponse, indicating some hosting was done
scenario.runTape('can log a host response', async (t, { app }) => {

  const request_addr = app.call("service", "log_request", {"entry" : sample_request})

  // try to log a response with a bad request_hash
  const bad_response = {
    request_hash: "xxxxxxx-fake-address-xxxxxxx",
    hosting_stats: {
      cpu_seconds: 3.2,
      bytes_in: 12309,
      bytes_out: 7352,
    },
    response_data_hash: "QmVtcYog4isPhcurmZxkggnCnoKVdAmb97VZy6Th6aV1xv",
    response_log: '64.242.88.10 - - [07/Mar/2004:16:11:58 -0800] "GET /twiki/bin/view/TWiki/WikiSyntax HTTP/1.1" 200 7352',
    host_signature: "QmXsSgDu7NNdAq7F9rmmHSaRz79a8njtkaYgRqxzz1taKk"
  }
  const failure = app.call("service", "log_response", {"entry" : bad_response})
  t.ok(failure.Err.Internal.includes("ClientRequest entry not found!"), "should generate an error")

  // Log a valid response
  const response = {
    request_hash: request_addr.Ok,
    hosting_stats: {
      cpu_seconds: 3.2,
      bytes_in: 12309,
      bytes_out: 7352,
    },
    response_data_hash: "QmVtcYog4isPhcurmZxkggnCnoKVdAmb97VZy6Th6aV1xv",
    response_log: '64.242.88.10 - - [07/Mar/2004:16:11:58 -0800] "GET /twiki/bin/view/TWiki/WikiSyntax HTTP/1.1" 200 7352',
    host_signature: "QmXsSgDu7NNdAq7F9rmmHSaRz79a8njtkaYgRqxzz1taKk"
  }
  const addr = app.call("service", "log_response", {"entry" : response})

  const result = app.call("service", "get_response", {"address": addr.Ok})

  t.deepEqual(result, { Ok: { App: [ 'host_response', JSON.stringify(response) ] } })
})

// 3. With the client signature on that HostResponse, the Conductor creates a ServiceLog, that is a billable log
scenario.runTape('can create a servicelog', async (t, { app }) => {

  app.call("service", "log_request", {"entry" : sample_request})

  const addr = app.call("service", "log_response", {"entry" : sample_response1})

  // try to log a bad service_log 
  const bad_service_log = {
    response_hash: "xxx-fakeaddr-xxx",
    client_signature: "noxsig"
  }
  const failure = app.call("service", "log_service", {"entry": bad_service_log})
  t.ok(failure.Err.Internal.includes("HostResponse entry not found!"), "should generate an error")

  // then log an actual service_log
  const service_log = {
    response_hash: addr.Ok,
    client_signature: "QmXsSgDu7NNdAq7F9rmmHSaRz79a8njtkaYgRqxzz1tZKk"
  }

  const addr2 = app.call("service", "log_service", {"entry": service_log})

  const result = app.call("service", "get_service", {"address": addr2.Ok})

  t.deepEqual(result, { Ok: { App: [ 'service_log', JSON.stringify(service_log) ] } })
})

// 4. List all billable ServiceLogs. TODO: filter by start and end time (for pagination)
scenario.runTape('log then list all servicelog', async (t, { app }) => {

  app.call("service", "log_request", {"entry" : sample_request})

  // Log a first response & service_log
  const addr1 = app.call("service", "log_response", {"entry" : sample_response1})
  const service_log1 = {
    response_hash: addr1.Ok,
    client_signature: "QmXsSgDu7NNdAq7F9rmmHSaRz79a8njtkaYgRqxzz1tZKk"
  }
  const sl_addr1 = app.call("service", "log_service", {"entry": service_log1})

  // Log a second response & service_log
  const addr2 = app.call("service", "log_response", {"entry" : sample_response1})
  const service_log2 = {
    response_hash: addr2.Ok,
    client_signature: "QmXsSgDu7NNdAq7F9rmmHSaRz79a8njtkaYgRqxzz1tZKk"
  }
  const sl_addr2 = app.call("service", "log_service", {"entry": service_log2})

  const results = app.call("service", "list_servicelogs", {})

  t.deepEqual(results, [sl_addr1.Ok, sl_addr2.Ok])
})


// 5. Generate an invoice based on the selected ServiceLogs
scenario.runTape('generating an invoice', async (t, { app, fuel }) => {

  app.call("service", "log_request", {"entry" : sample_request})

  // Log a first response & service_log
  const addr1 = app.call("service", "log_response", {"entry" : sample_response1})
  const service_log1 = {
    response_hash: addr1.Ok,
    client_signature: "QmXsSgDu7NNdAq7F9rmmHSaRz79a8njtkaYgRqxzz1tZKk"
  }
  app.call("service", "log_service", {"entry": service_log1})

  // Log a second response & service_log
  const addr2 = app.call("service", "log_response", {"entry" : sample_response1})
  const service_log2 = {
    response_hash: addr2.Ok,
    client_signature: "QmXsSgDu7NNdAq7F9rmmHSaRz79a8njtkaYgRqxzz1tZKk"
  }
  app.call("service", "log_service", {"entry": service_log1})

  const result = app.call("service", "generate_invoice", {"price_per_unit": 1.0})

  t.deepEqual(result, "xoxoxo")
})


// 6. Checks if the unpaid value is greater than the PaymentPrefs, then call stop_hosting() on Hosting App
