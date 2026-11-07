// seed_marks.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // 1. Create a Formative Assessment for Biology (Subject ID 3)
  // Changed 'Formative 1' to 'Formative' to satisfy the CHECK constraint
  db.run(`
    INSERT INTO assessments (subject_id, assessment_type, max_score, term, year)
    VALUES (3, 'Formative', 20, 1, 2026)
  `, function(err) {
    if (err) return console.error(err.message);
    const assessmentId = this.lastID;

    // 2. Record score (17/20) for Student 1 (Akello Sarah)
    db.run(`
      INSERT INTO record_marks (assessment_id, student_id, score)
      VALUES (?, 1, 17)
    `, [assessmentId], (err) => {
      if (err) return console.error(err.message);
      console.log('Sample mark added successfully!');
      
      db.close();
    });
  });
});