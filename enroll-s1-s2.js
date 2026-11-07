const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join(__dirname, "database.db");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run("PRAGMA foreign_keys = ON");

  const compulsoryNames = [
    "English Language", "Mathematics", "Biology", "Chemistry", "Physics",
    "Geography", "History and Political Education", "Kiswahili",
    "Physical Education", "Religious Education", "Entrepreneurship"
  ];
  const electiveNames = ["ICT", "Agriculture", "Art and Design", "Performing Arts"];

  // Fetch all registered schools
  db.all(`SELECT id, name FROM schools`, [], (err, schools) => {
    if (err || schools.length === 0) {
      console.error("No schools found.");
      db.close();
      return;
    }

    db.all(`SELECT id, name FROM subjects`, [], (err, subjects) => {
      if (err) {
        db.close();
        return;
      }

      const subjectMap = {};
      subjects.forEach(sub => { subjectMap[sub.name] = sub.id; });

      const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO student_subjects (student_id, subject_id, is_elective) 
        VALUES (?, ?, ?)
      `);

      let processedCount = 0;

      schools.forEach((school) => {
        // Query S1 & S2 students scoped per school
        db.all(
          `SELECT s.id AS student_id 
           FROM students s 
           JOIN classes c ON s.class_id = c.id 
           WHERE s.school_id = ? AND c.level IN (1, 2)`,
          [school.id],
          (err, students) => {
            if (!err && students) {
              students.forEach((student, index) => {
                // Map compulsory
                compulsoryNames.forEach(subName => {
                  if (subjectMap[subName]) {
                    insertStmt.run(student.student_id, subjectMap[subName], 0);
                  }
                });
                // Map 1 elective
                const chosenElective = electiveNames[index % electiveNames.length];
                if (subjectMap[chosenElective]) {
                  insertStmt.run(student.student_id, subjectMap[chosenElective], 1);
                }
              });
              console.log(`Enrolled ${students.length} S1/S2 students for: ${school.name}`);
            }

            processedCount++;
            if (processedCount === schools.length) {
              insertStmt.finalize(() => db.close());
            }
          }
        );
      });
    });
  });
});