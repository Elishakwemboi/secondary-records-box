const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join(__dirname, "database.db");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run("PRAGMA foreign_keys = ON");

  const schoolId = 1; // Kampala High School

  // Fetch S1 class ID for this specific school
  db.get(
    `SELECT id FROM classes WHERE school_id = ? AND name = 'Senior 1'`,
    [schoolId],
    (err, classRow) => {
      if (err || !classRow) {
        console.error("Class not found:", err);
        db.close();
        return;
      }

      const classId = classRow.id;

      // Insert Sample Students
      const insertStudent = db.prepare(`
        INSERT INTO students (school_id, class_id, full_name, lin) 
        VALUES (?, ?, ?, ?)
      `);

      const students = [
        [schoolId, classId, "John Mukasa", "LIN-2026-001"],
        [schoolId, classId, "Sarah Namubiru", "LIN-2026-002"],
        [schoolId, classId, "David Okello", "LIN-2026-003"]
      ];

      students.forEach(st => insertStudent.run(...st));
      insertStudent.finalize((err) => {
        if (!err) {
          console.log(`Successfully added ${students.length} students to Senior 1 (School ID: ${schoolId}).`);
        }
        // Safely close connection after operations complete
        db.close();
      });
    }
  );
});