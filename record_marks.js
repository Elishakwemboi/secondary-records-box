const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join(__dirname, "database.db");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run("PRAGMA foreign_keys = ON");

  const schoolId = 1; // Kampala High School
  const term = 1;
  const year = 2026;

  // 1. Fetch Subject ID for Physics
  db.get(`SELECT id FROM subjects WHERE name = 'Physics'`, [], (err, subject) => {
    if (err || !subject) return console.error("Subject not found:", err);

    // 2. Create Formative Assessment using exact table columns
    const createAssessment = db.prepare(`
      INSERT INTO assessments (school_id, subject_id, assessment_type, max_score, term, year)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    createAssessment.run(
      schoolId, subject.id,
      "Formative", 3.0, term, year,
      function (err) {
        if (err) return console.error("Error creating assessment:", err.message);

        const assessmentId = this.lastID;
        console.log(`Created Assessment ID ${assessmentId}: Formative (Max: 3.0)`);

        // 3. Fetch Students enrolled in Physics for this school
        db.all(
          `SELECT ss.student_id 
           FROM student_subjects ss
           JOIN students st ON ss.student_id = st.id
           WHERE ss.subject_id = ? AND st.school_id = ?`,
          [subject.id, schoolId],
          (err, students) => {
            if (err || students.length === 0) return console.error("No enrolled students found.");

            const insertMark = db.prepare(`
              INSERT OR REPLACE INTO record_marks (assessment_id, student_id, score)
              VALUES (?, ?, ?)
            `);

            // Sample Scores on NCDC 1.0 - 3.0 Descriptor Scale
            const sampleScores = [2.5, 3.0, 1.8];

            students.forEach((st, idx) => {
              const score = sampleScores[idx % sampleScores.length];
              insertMark.run(assessmentId, st.student_id, score);
            });

            insertMark.finalize((err) => {
              if (!err) console.log(`Recorded Formative marks for ${students.length} students.`);
              db.close();
            });
          }
        );
      }
    );
    createAssessment.finalize();
  });
});