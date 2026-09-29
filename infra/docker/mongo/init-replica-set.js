// Member host is 127.0.0.1 so a driver on the host can use the published port.
// Containers must connect with directConnection=true; otherwise they follow this
// advertisement back to their own loopback.
const memberHost = "127.0.0.1:27017";

function isPrimary() {
  return db.hello().isWritablePrimary === true;
}

try {
  const status = rs.status();
  if (!status.ok) {
    throw new Error("replica set status is not ok");
  }
  const memberName = status.members && status.members[0] && status.members[0].name;
  if (memberName !== memberHost) {
    print(
      "replica set member host is " +
        memberName +
        " but local development requires " +
        memberHost +
        ". Remove the mongo volume and start again.",
    );
    quit(1);
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
