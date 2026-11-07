const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join(__dirname, "database.db");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run("PRAGMA foreign_keys = ON");

  // 1. NCDC S3-S4 Compulsory Core Subjects (7 Core)
  const compulsoryNames = [
    "English Language",
    "Mathematics",
    "Biology",
    "Chemistry",
    "Physics",
    "Geography",
    "History and Political Education"
  ];

  // 2. Complete S3-S4 Elective Options Pool (Includes CRE/RE, PE, ICT, etc.)
  const electivePool = [
    "Religious Education",
    "Physical Education",
    "Entrepreneurship",
    "ICT",
    "Agriculture",
    "Kiswahili",
    "Art and Design",
    "Performing Arts",
    "Nutrition and Food Technology",
    "Technology and Design",
    "Literature in English"
  ];

  // Fetch all registered schools
  db.all(`SELECT id, name FROM schools`, [], (err, schools) => {
    if (err || schools.length === 0) {
      console.error("No schools found.");
      db.close();
      return;
    }

    // Fetch subject mappings from the database
    db.all(`SELECT id, name FROM subjects`, [], (err, subjects) => {
      if (err) {
        db.close();
        return;
      }

      const subjectMap = {};
      subjects.forEach((sub) => {
        subjectMap[sub.name] = sub.id;
      });

      const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO student_subjects (student_id, subject_id, is_elective) 
        VALUES (?, ?, ?)
      `);

      let processedCount = 0;

      schools.forEach((school) => {
        // Query S3 & S4 students scoped per school
        db.all(
          `SELECT s.id AS student_id 
           FROM students s 
           JOIN classes c ON s.class_id = c.id 
           WHERE s.school_id = ? AND c.level IN (3, 4)`,
          [school.id],
          (err, students) => {
            if (!err && students) {
              students.forEach((student, index) => {
                // Map 7 core subjects (is_elective = 0)
                compulsoryNames.forEach((subName) => {
                  if (subjectMap[subName]) {
                    insertStmt.run(student.student_id, subjectMap[subName], 0);
                  }
                });

                // Pick 2 electives dynamically per student (is_elective = 1)
                const elective1 = electivePool[index % electivePool.length];
                const elective2 = electivePool[(index + 1) % electivePool.length];

                [elective1, elective2].forEach((subName) => {
                  if (subjectMap[subName]) {
                    insertStmt.run(student.student_id, subjectMap[subName], 1);
                  }
                });
              });
              console.log(`Enrolled ${students.length} S3/S4 students for: ${school.name}`);
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