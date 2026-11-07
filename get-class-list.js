const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join(__dirname, "database.db");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // 1. Ensure Classes Table exists
  db.run(`
    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      level INTEGER NOT NULL,
      max_subjects INTEGER NOT NULL
    )
  `);

  // 2. Ensure Streams Table exists
  db.run(`
    CREATE TABLE IF NOT EXISTS streams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    )
  `);

  // 3. Ensure Students Table exists
  db.run(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lin TEXT UNIQUE,
      full_name TEXT NOT NULL,
      gender TEXT CHECK(gender IN ('M', 'F')),
      class_id INTEGER NOT NULL,
      stream_id INTEGER,
      status TEXT DEFAULT 'Active' CHECK(status IN ('Active', 'Transferred', 'Graduated', 'Suspended')),
      FOREIGN KEY (class_id) REFERENCES classes(id),
      FOREIGN KEY (stream_id) REFERENCES streams(id)
    )
  `);

  // Insert default classes & streams
  db.run(`
    INSERT OR IGNORE INTO classes (name, level, max_subjects) VALUES 
      ('Senior 1', 1, 12),
      ('Senior 2', 2, 12),
      ('Senior 3', 3, 9),
      ('Senior 4', 4, 9)
  `);
  db.run(`INSERT OR IGNORE INTO streams (name) VALUES ('A'), ('B'), ('North'), ('South')`);

  // 4. Fetch Class List after tables are guaranteed to exist
  const classId = 1; // 1 = Senior 1
  const query = `
    SELECT 
      s.id,
      s.lin,
      s.full_name,
      s.gender,
      c.name AS class_name,
      st.name AS stream_name,
      s.status
    FROM students s
    JOIN classes c ON s.class_id = c.id
    LEFT JOIN streams st ON s.stream_id = st.id
    WHERE s.class_id = ?
    ORDER BY s.full_name ASC
  `;

  db.all(query, [classId], (err, rows) => {
    if (err) {
      console.error("Error fetching class list:", err.message);
      return;
    }
    console.log(`\n=== CLASS LIST (Senior 1) ===`);
    if (rows.length === 0) {
      console.log("No students found in this class yet.");
    } else {
      console.table(rows);
    }
  });
});

db.close();