const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join(__dirname, "database.db");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run("PRAGMA foreign_keys = ON;");

  const schoolId = 1; // Kampala High School

  // Insert Teacher into the 'users' table
  const insertTeacher = db.prepare(`
    INSERT INTO users (school_id, full_name, email, password_hash, role) 
    VALUES (?, ?, ?, ?, 'teacher')
  `);

  insertTeacher.run(
    schoolId,
    "Mr. Okot Patrick",
    "okot.patrick@kampalahigh.sc.ug",
    "teacher123",
    function (err) {
      if (err) {
        if (err.message.includes("UNIQUE constraint failed: users.email")) {
          console.log("Teacher already exists with this email.");
        } else {
          console.error("Error adding teacher:", err.message);
        }
        insertTeacher.finalize(() => db.close());
        return;
      }

      const teacherId = this.lastID;
      console.log(`Created Teacher: Mr. Okot Patrick (ID: ${teacherId})`);

      insertTeacher.finalize(() => {
        db.close((closeErr) => {
          if (closeErr) console.error("Error closing database:", closeErr.message);
        });
      });
    }
  );
});