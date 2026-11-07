const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join(__dirname, "database.db");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run("PRAGMA foreign_keys = ON");

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO schools (name, center_number) 
    VALUES (?, ?)
  `);

  const sampleSchools = [
    ["Kampala High School", "U0001"],
    ["MengSS Secondary School", "U0002"]
  ];

  sampleSchools.forEach(([name, centerNo]) => {
    stmt.run(name, centerNo);
  });

  stmt.finalize(() => {
    console.log("Schools seeded successfully (duplicates skipped).");
    db.close();
  });
});