// Pod DNS, not the Compose loopback. Drivers in the namespace use the same host.
const memberHost = "mongo-0.mongo.commerce-flow.svc.cluster.local:27017";

function isPrimary() {
  return db.hello().isWritablePrimary === true;
}

try {
  const status = rs.status();
  if (!status.ok) {
    throw new Error("replica set status is not ok");
  }
} catch (error) {
  const result = rs.initiate({
    _id: "rs0",
    members: [{ _id: 0, host: memberHost }],
  });
  if (!result.ok) {
    print("rs.initiate failed");
    quit(1);
  }
}

for (let attempt = 0; attempt < 60; attempt += 1) {
  if (isPrimary()) {
    print("replica set rs0 is primary at " + memberHost);
    quit(0);
  }
  sleep(1000);
}

print("replica set did not elect a primary");
quit(1);
