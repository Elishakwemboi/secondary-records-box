const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join(__dirname, "database.db");

/**
 * Clean & Standardize Inputs
 */
function cleanTerm(raw) {
  if (typeof raw === "number") return raw;
  if (!raw) return 1;
  const match = String(raw).match(/\d+/);
  return match ? parseInt(match[0], 10) : 1;
}

function cleanAssessmentType(raw) {
  if (!raw) return "Formative";
  const str = String(raw).toLowerCase();
  if (str.includes("summative")) return "Summative";
  return "Formative";
}

/**
 * NCDC Competence Descriptors (Formative / AOI Average out of 3.0)
 */
function getDescriptor(avgFormativeRaw) {
  if (avgFormativeRaw >= 2.5) return "3 - Outstanding";
  if (avgFormativeRaw >= 1.5) return "2 - Moderate";
  if (avgFormativeRaw > 0) return "1 - Basic";
  return "N/A";
}

/**
 * NCDC Grading Scale (Final Total Percentage)
 */
function getGrade(totalPercentage) {
  if (totalPercentage >= 80) return "A*";
  if (totalPercentage >= 70) return "A";
  if (totalPercentage >= 60) return "B";
  if (totalPercentage >= 50) return "C";
  if (totalPercentage >= 40) return "D";
  return "E";
}

/**
 * Automated Comments
 */
function getSubjectComment(totalPercentage) {
  if (totalPercentage >= 75) return "Excellent understanding and performance.";
  if (totalPercentage >= 50) return "Good progress, keep practicing.";
  return "Needs extra attention and revision.";
}

function getClassTeacherComment(avgPercentage) {
  if (avgPercentage >= 75) return "An outstanding student with high academic standards.";
  if (avgPercentage >= 50) return "Good performance overall, capable of achieving higher.";
  return "Requires consistent practice and closer academic monitoring.";
}

function getHeadTeacherComment(avgPercentage) {
  if (avgPercentage >= 75) return "Promising results. Maintain this high level of excellence.";
  if (avgPercentage >= 50) return "Fair result. Aim for higher competence next term.";
  return "Must put in double effort next term.";
}

/**
 * Core Data Calculation Strategy (Supports Generating Blank Reports)
 */
function calculateReports(db, options = {}, callback) {
  const schoolIdVal = parseInt(options.schoolId || options.school_id, 10) || 1;
  const rawTerm = options.term || options.termVal || '2';
  const termVal = String(rawTerm).replace(/\D/g, '') || '2';
  
  let className = options.className || options.class_name || null;
  if (className) {
    className = className.replace(/^:/, '').trim(); // Strips leading colon if present
  }

  // Step 1: Fetch all students and their classes first
  let studentQuery = `
    SELECT 
      st.id AS student_id,
      st.full_name AS student_name,
      c.id AS class_id,
      c.name AS class_name
    FROM students st
    JOIN classes c ON st.class_id = c.id
    WHERE st.school_id = ?
  `;
  const studentParams = [schoolIdVal];

  if (className && className !== 'ALL') {
    studentQuery += ` AND (CAST(c.id AS TEXT) = ? OR LOWER(TRIM(c.name)) = LOWER(?) OR LOWER(c.name) LIKE LOWER(?))`;
    studentParams.push(className, className, `%${className}%`);
  }

  db.all(studentQuery, studentParams, (err, students) => {
    if (err) {
      console.error("DEBUG Student Query Error:", err);
      return callback(err);
    }

    if (!students || students.length === 0) {
      return callback(null, []);
    }

    // Step 2: Fetch all subjects available for this school
    db.all(`SELECT id, name FROM subjects WHERE school_id = ?`, [schoolIdVal], (subErr, allSubjects) => {
      const subjectsList = allSubjects && allSubjects.length > 0 ? allSubjects : [];

      // Step 3: Fetch marks for the specified term
      let marksQuery = `
  SELECT 
    st.id AS student_id,
    sub.id AS subject_id,
    sub.name AS subject_name,
    m.exam_type AS assessment_type,
    m.score AS score
  FROM students st
  JOIN classes c ON st.class_id = c.id
  JOIN marks m 
    ON m.student_id = st.id
    AND m.school_id = st.school_id
    AND m.class_id = st.class_id
  JOIN subjects sub 
    ON m.subject_id = sub.id
    AND sub.school_id = st.school_id
  WHERE st.school_id = ?
    AND CAST(m.term AS TEXT) = CAST(? AS TEXT)
`;
      const marksParams = [schoolIdVal, termVal];

      if (className && className !== 'ALL') {
        marksQuery += ` AND (CAST(c.id AS TEXT) = ? OR LOWER(TRIM(c.name)) = LOWER(?) OR LOWER(c.name) LIKE LOWER(?))`;
        marksParams.push(className, className, `%${className}%`);
      }

      db.all(marksQuery, marksParams, (markErr, rows) => {
        if (markErr) {
          console.warn("DEBUG Marks Query warning:", markErr);
        }

        // Initialize report objects for every student found
        const reports = {};
        students.forEach((st) => {
          reports[st.student_id] = {
            id: st.student_id,
            name: st.student_name,
            class: st.class_name,
            schoolName: "",
            subjects: {}
          };

          // Pre-populate subjects so even blank reports show the subject rows properly
          subjectsList.forEach((sub) => {
            reports[st.student_id].subjects[sub.name] = {
              formativeEntries: [],
              summativeScore: 0,
              summativeMax: 80.0,
              hasSummative: false
            };
          });
        });

        // Populate marks if available
        if (rows && rows.length > 0) {
          rows.forEach((row) => {
            if (!reports[row.student_id]) return;
            const student = reports[row.student_id];
            
            if (!student.subjects[row.subject_name]) {
              student.subjects[row.subject_name] = {
                formativeEntries: [],
                summativeScore: 0,
                summativeMax: 80.0,
                hasSummative: false
              };
            }

            const subObj = student.subjects[row.subject_name];
            const rawType = String(row.assessment_type || '').toLowerCase();

            if (rawType.includes("formative") || rawType.includes("activity") || rawType.includes("aoi") || rawType === "f") {
              subObj.formativeEntries.push({
                score: Number(row.score) || 0,
                max: 3.0
              });
            } else {
              subObj.summativeScore = Number(row.score) || 0;
              subObj.summativeMax = 80.0;
              subObj.hasSummative = true;
            }
          });
        }

        // Step 4: Process final NCDC calculations & Enforce Subject Counts
        const studentList = Object.values(reports);
        studentList.forEach((st) => {
          let totalSubjects = 0;
          let totalPercentageSum = 0;

          // Determine NCDC Curriculum Subject Limit based on Class Name
          const classNameLower = (st.class || '').toLowerCase();
          const isLowerOLevel = classNameLower.includes('senior 1') || classNameLower.includes('senior 2');
          const maxAllowedSubjects = isLowerOLevel ? 12 : 9; // S1-S2: 12 subjects | S3-S4: 9 subjects

          // CRITICAL FIX: Sort subjects so that any subject with actual entered marks floats to the top,
          // preventing positional mismatch with default subjects like ICT/Kiswahili.
          const subjectEntries = Object.entries(st.subjects).sort(([, a], [, b]) => {
            const aHasMarks = (a.formativeEntries && a.formativeEntries.length > 0) || a.hasSummative ? 1 : 0;
            const bHasMarks = (b.formativeEntries && b.formativeEntries.length > 0) || b.hasSummative ? 1 : 0;
            return bHasMarks - aHasMarks; // Subjects with recorded marks come first
          });

          const activeSubjects = subjectEntries.slice(0, maxAllowedSubjects);

          // Rebuild student subjects to only include the allowed active count
          st.subjects = {};

          activeSubjects.forEach(([subName, sub]) => {
            let formative20 = 0;
            let avgFormativeRaw = 0;

            if (sub.formativeEntries.length > 0) {
              const sumAchieved = sub.formativeEntries.reduce((acc, entry) => acc + entry.score, 0);
              const sumMax = sub.formativeEntries.reduce((acc, entry) => acc + entry.max, 0);
              
              avgFormativeRaw = sumAchieved / sub.formativeEntries.length;
              formative20 = sumMax > 0 ? (sumAchieved / sumMax) * 20 : 0;
            }

            const summative80 = sub.hasSummative 
              ? (sub.summativeScore / sub.summativeMax) * 80 
              : 0;
              
            const finalScore = Math.round(formative20 + summative80);

            sub.avgFormativeRaw = avgFormativeRaw;
            sub.formative20 = formative20;
            sub.summative80 = summative80;
            sub.finalScore = finalScore;
            sub.descriptor = getDescriptor(avgFormativeRaw);
            sub.grade = getGrade(finalScore);
            sub.comment = getSubjectComment(finalScore);

            st.subjects[subName] = sub;
            totalPercentageSum += finalScore;
            totalSubjects += 1;
          });

          st.subjectCount = totalSubjects;
          st.avgPercentage = totalSubjects > 0 ? totalPercentageSum / totalSubjects : 0;
          st.classTeacherComment = getClassTeacherComment(st.avgPercentage);
          st.headTeacherComment = getHeadTeacherComment(st.avgPercentage);
        });

        // Step 5: Sort students by average percentage & assign ranks
        studentList.sort((a, b) => b.avgPercentage - a.avgPercentage);
        studentList.forEach((st, index) => {
          st.rank = index + 1;
        });

        callback(null, studentList);
      });
    });
  });
}

/**
 * Standalone CLI Print Output
 */
function generateReportsCLI(schoolId = 1, term = 1, year = 2026, className = null) {
  const db = new sqlite3.Database(dbPath);
  db.serialize(() => {
    db.run("PRAGMA foreign_keys = ON");
    calculateReports(db, { schoolId, term, year, className }, (err, studentList) => {
      if (err) {
        console.error("Error generating report cards:", err.message);
        db.close();
        return;
      }

      if (!studentList || studentList.length === 0) {
        console.log("No students found for this criteria.");
        db.close();
        return;
      }

      const totalStudentsInClass = studentList.length;

      studentList.forEach((student) => {
        const headerSchoolName = (student.schoolName || "KAPKWATA SSS").toUpperCase();
        console.log(`========================================================================================================================`);
        console.log(`                                           ${headerSchoolName} - REPORT CARD                                            `);
        console.log(`                                       LOWER SECONDARY CURRICULUM (NCDC STANDARDS)                                      `);
        console.log(`                                               TERM ${term}, ACADEMIC YEAR ${year}                                      `);
        console.log(`========================================================================================================================`);
        console.log(` NAME : ${student.name.padEnd(28, ' ')} CLASS: ${student.class.padEnd(20, ' ')} TERM: Term ${term}`);
        console.log(` RANK : ${student.rank} / ${totalStudentsInClass}`.padEnd(52, ' ') + `AVERAGE SCORE: ${student.avgPercentage.toFixed(1)}%`);
        console.log(`------------------------------------------------------------------------------------------------------------------------`);
        console.log(`SUBJECT        | FORMATIVE (20%) | SUMMATIVE (80%) | TOTAL (100%) | GRADE | DESCRIPTOR         | TEACHER COMMENT   `);
        console.log(`------------------------------------------------------------------------------------------------------------------------`);

        Object.keys(student.subjects).forEach((subjectName) => {
          const sub = student.subjects[subjectName];
          const form20Str = `${sub.formative20.toFixed(1)}%`;
          const sumValStr = sub.hasSummative ? `${sub.summativeScore}/${sub.summativeMax} (${sub.summative80.toFixed(1)}%)` : "N/A (0.0%)";

          const subCol = subjectName.padEnd(14, " ");
          const formCol = form20Str.padEnd(16, " ");
          const sumCol = sumValStr.padEnd(16, " ");
          const totalCol = `${sub.finalScore}%`.padEnd(13, " ");
          const gradeCol = sub.grade.padEnd(6, " ");
          const descCol = sub.descriptor.padEnd(18, " ");

          console.log(`${subCol} | ${formCol} | ${sumCol} | ${totalCol} | ${gradeCol} | ${descCol} | ${sub.comment}`);
        });

        console.log(`------------------------------------------------------------------------------------------------------------------------`);
        console.log(`NCDC DESCRIPTORS KEY: 3 = Outstanding (>=2.5) | 2 = Moderate (>=1.5) | 1 = Basic (>0)`);
        console.log(`CLASS TEACHER'S REMARKS: ${student.classTeacherComment}`);
        console.log(`HEAD TEACHER'S REMARKS : ${student.headTeacherComment}`);
        console.log(`========================================================================================================================\n\n`);
      });

      db.close();
    });
  });
}

module.exports = { 
  calculateReports, 
  generateReportsCLI, 
  getDescriptor, 
  getGrade, 
  getSubjectComment, 
  getClassTeacherComment, 
  getHeadTeacherComment,
  cleanTerm,
  cleanAssessmentType
};

// Standalone execution check
if (require.main === module) {
  generateReportsCLI(1, 1, 2026);
}