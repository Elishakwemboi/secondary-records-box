require('dotenv').config();
const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const session = require("express-session");

app.use(session({
    secret: 'secondary_school_box_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,      // Must be false for local HTTP development
        httpOnly: true,     // Prevents client-side scripts from reading the cookie
        maxAge: 24 * 60 * 60 * 1000 // 1 day session lifespan
    }
}));
// Use /tmp directory on Vercel because the root folder is read-only
const dbPath = process.env.VERCEL ? path.join('/tmp', 'database.db') : path.join(__dirname, "database.db");
const db = new sqlite3.Database(dbPath);
const { calculateReports } = require('./generate-report-card');

const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

console.log(
  "Gemini API key loaded:",
  Boolean(process.env.GEMINI_API_KEY)
);

db.run("PRAGMA foreign_keys = ON");

// Ensure subjects table exists and schools table has code column
db.serialize(() => {
            // 1. Subjects Table
           db.run(`
                CREATE TABLE IF NOT EXISTS schools (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    code TEXT UNIQUE
                )
            `);
           
            db.run(`
                CREATE TABLE IF NOT EXISTS subjects (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    school_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    code TEXT,
                    FOREIGN KEY (school_id) REFERENCES schools(id)
                )
            `);

            // 2. School Term Settings Table
            db.run(`
                CREATE TABLE IF NOT EXISTS school_term_settings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    school_id INTEGER NOT NULL,
                    term_name TEXT NOT NULL,
                    closing_date TEXT,
                    next_term_opening_date TEXT,
                    default_next_term_fees REAL,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (school_id) REFERENCES schools(id)
                )
            `);

            // 3. Users Table
            db.run(`
                CREATE TABLE IF NOT EXISTS users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    username TEXT UNIQUE NOT NULL,
                    email TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    full_name TEXT NOT NULL,
                    is_active INTEGER DEFAULT 1,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);

            // 4. User Roles Mapping Table
            db.run(`
                CREATE TABLE IF NOT EXISTS user_roles (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER,
                    role_name TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `);

            // 5. Teacher Subject Allocations Table
            db.run(`
                CREATE TABLE IF NOT EXISTS subject_allocations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    teacher_id INTEGER,
                    class_id TEXT NOT NULL,
                    stream_id TEXT NOT NULL,
                    subject_name TEXT NOT NULL,
                    FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `);
          db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'teacher'
  )
`);

            // 6. Class Teacher Allocations Table
            db.run(`
                CREATE TABLE IF NOT EXISTS class_teacher_allocations (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    teacher_id INTEGER,
                    class_id TEXT NOT NULL,
                    stream_id TEXT NOT NULL,
                    FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
                )
            `, (createErr) => {
                if (createErr) {
                    console.error('Error creating tables:', createErr.message);
                } else {
                    console.log('All database tables verified/created successfully.');
                }
            });
        });

db.all(`SELECT st.school_id, st.full_name, c.name as class_name, m.term, m.score FROM marks m JOIN students st ON m.student_id = st.id JOIN classes c ON st.class_id = c.id`, [], (err, rows) => {
  console.log("=== DB MARKS CHECK ===", rows);
});
db.all("PRAGMA table_info(school_term_settings)", (err, rows) => {
    if (err) {
        console.error("Table check error:", err);
    } else {
        console.log("SCHOOL TERM SETTINGS COLUMNS:", rows);
    }
});
db.all("SELECT * FROM school_term_settings", (err, rows) => {
    if (err) {
        console.error(err);
    } else {
        console.log("EXISTING TERM SETTINGS:", rows);
    }
});
// Automatically ensure school_id exists in school_term_settings without losing data
db.run(`ALTER TABLE school_term_settings ADD COLUMN school_id INTEGER;`, (err) => {
  if (err) {
    // Column likely already exists, which is safe to ignore
    console.log("school_term_settings table check: school_id column already present or handled.");
  } else {
    console.log("Successfully migrated: Added school_id column to school_term_settings!");
  }
});
db.all("PRAGMA table_info(marks)", [], (err, rows) => {
  if (err) {
    console.error("MARKS TABLE ERROR:", err);
    return;
  }

  console.log("===== MARKS TABLE STRUCTURE =====");
  console.table(rows);
});
db.all("PRAGMA index_list(marks)", [], (err, indexes) => {
  if (err) return console.error(err);

  console.log("===== MARKS TABLE INDEXES =====");
  console.table(indexes);

  indexes.forEach(index => {
    db.all(`PRAGMA index_info("${index.name}")`, [], (err, columns) => {
      if (!err) {
        console.log("INDEX:", index.name);
        console.table(columns);
      }
    });
  });
});
db.all(`
  SELECT
    m.id,
    m.school_id,
    m.class_id,
    m.student_id,
    st.full_name AS student_name,
    m.subject_id,
    sub.name AS subject_name,
    m.exam_type,
    m.term,
    m.score
  FROM marks m
  LEFT JOIN students st ON st.id = m.student_id
  LEFT JOIN subjects sub ON sub.id = m.subject_id
  ORDER BY m.id DESC
  LIMIT 20
`, [], (err, rows) => {
  if (err) {
    console.error("MARKS CHECK ERROR:", err);
    return;
  }

  console.log("===== LAST 20 UPLOADED MARKS =====");
  console.table(rows);
});
   // Migration: Add missing 'code' column to schools table
    db.run("ALTER TABLE schools ADD COLUMN code TEXT;", (err) => {
        // Ignore error if column already exists
    });
// Migration: Add missing 'class_teacher_id' column to classes table
db.run("ALTER TABLE classes ADD COLUMN class_teacher_id INTEGER;", (err) => {
    // Ignore error if column already exists
});

db.run(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'teacher'`, (err) => {
  if (err) {
    // Column likely already exists, which is safe to ignore
    console.log("Role column check: column already present or handled.");
  } else {
    console.log("Successfully added missing role column to users table.");
  }
});

    // Migration: Add missing 'teacher_id' column to classes table
    db.run("ALTER TABLE classes ADD COLUMN teacher_id INTEGER;", (err) => {
        // Ignore error if column already exists
    });
db.run("ALTER TABLE students ADD COLUMN gender TEXT", (err) => {
  if (err) {
    console.log("Gender column already exists or migration skipped:", err.message);
  } else {
    console.log("Successfully added gender column to students table!");
  }
});
db.run("ALTER TABLE marks ADD COLUMN term TEXT;", (err) => {
  if (err) {
    // If the column already exists, SQLite throws an error which we safely ignore
    console.log("term column migration skipped or already exists.");
  } else {
    console.log("Successfully added 'term' column to 'marks' table.");
  }
});
db.run("CREATE UNIQUE INDEX IF NOT EXISTS idx_marks_unique ON marks(student_id, subject_id, exam_type, term);", (err) => {
  if (err) {
    console.log("Index migration skipped or failed:", err.message);
  } else {
    console.log("Successfully created unique index on marks table.");
  }
});
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});
db.run("ALTER TABLE classes ADD COLUMN teacher_id INTEGER;", (err) => {
    // Ignore error if column already exists
});

// Middleware to restrict dashboard access based on allowed roles
function requireRole(allowedRoles) {
    const rolesArray = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    const cleanAllowedRoles = rolesArray.map(r => r.trim().toLowerCase().replace(/[\s_]+/g, ''));

    return async (req, res, next) => {
        // 1. Check if user is logged in and session exists
        if (!req.session || !req.session.user) {
            if (req.xhr || req.headers.accept?.includes('json')) {
                return res.status(401).json({ error: "Unauthorized: Please log in first." });
            }
            return res.redirect('/login.html'); //
        }

        const userRole = req.session.user.activeRole || req.session.user.role || '';
        const cleanUserRole = userRole.trim().toLowerCase().replace(/[\s_]+/g, '');
        
        const isSuperAdmin = cleanUserRole.includes('superadmin');
        const isAuthorized = cleanAllowedRoles.includes(cleanUserRole) || 
                             cleanAllowedRoles.some(allowed => cleanUserRole.includes(allowed));

        if (!isAuthorized && !isSuperAdmin) {
            console.warn(`[Security] Unauthorized access attempt: User ID ${req.session.user.id} with role "${userRole}" tried to access restricted route.`);
            
            if (req.xhr || req.headers.accept?.includes('json')) {
                return res.status(403).json({ error: "Access Denied: You do not have permission to view this dashboard." });
            }
            
            return res.status(403).send(`
                <div style="font-family: sans-serif; text-align: center; margin-top: 50px;">
                    <h2 style="color: #d9534f;">403 - Access Denied</h2>
                    <p>You are logged in as a <strong>${userRole}</strong> and do not have permission to access this page.</p>
                    <a href="/dashboard/subject-teacher" style="color: #337ab7; text-decoration: none;">Return to your Dashboard</a>
                </div>
            `);
        }

        // 2. Safe optional check for Class Teachers (wrapped to prevent crashes if table is missing)
        if (cleanUserRole.includes('classteacher') || cleanUserRole.includes('classteacher')) {
            db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='class_teacher_allocations'", [], (tableErr, tableRow) => {
                if (tableRow) {
                    db.get("SELECT * FROM class_teacher_allocations WHERE teacher_id = ?", [req.session.user.id], (err, row) => {
                        if (!err && row) {
                            req.session.hasStreamAllocation = true;
                        }
                        next();
                    });
                } else {
                    next(); // Skip safely if table hasn't been migrated yet
                }
            });
        } else {
            next();
        }
    };
}

// Helper functions for parameter cleaning
function cleanTerm(raw) {
  if (typeof raw === 'number') return raw;
  if (!raw) return 1;
  const match = String(raw).match(/\d+/);
  return match ? parseInt(match[0], 10) : 1;
}

function cleanAssessmentType(raw) {
  if (!raw) return 'Formative';
  const str = String(raw).toLowerCase();
  if (str.includes('summative')) return 'Summative';
  return 'Formative';
}

const bcrypt = require('bcrypt');

// API: Register School & Admin Account
app.post("/api/schools", async (req, res) => {
  const { name, center_number, admin_name, admin_email, admin_phone, admin_password } = req.body;

  // 1. Validate required fields matching your frontend inputs
  if (!name || !center_number || !admin_email || !admin_password) {
    return res.status(400).json({ 
      error: "School Name, Center Number, Admin Email, and Password are required." 
    });
  }

  try {
    // 2. Hash the admin password securely using bcrypt
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(admin_password.trim(), saltRounds);
    const cleanEmail = admin_email.trim().toLowerCase();

    // 3. Insert the school record first
    db.run(`INSERT INTO schools (name, center_number) VALUES (?, ?)`, [name, center_number], function (err) {
      if (err) {
        return res.status(400).json({ error: "Failed to register school: " + err.message });
      }

      const schoolId = this.lastID; // Get the newly created school's ID

      // 4. Insert the School Admin user linked to this school_id
      // (Note: Add phone if your users table has a phone column, or omit it if not needed)
      const userSql = `
        INSERT INTO users (school_id, full_name, email, phone, password_hash, role) 
        VALUES (?, ?, ?, ?, ?, ?)
      `;
      
      const adminFullName = admin_name ? admin_name.trim() : "School Admin";

      db.run(userSql, [schoolId, adminFullName, cleanEmail, admin_phone || null, passwordHash, "School Admin"], function (userErr) {
        if (userErr) {
          console.error("Error creating admin user:", userErr);
          return res.status(400).json({ 
            error: "School created, but failed to create admin user: " + userErr.message 
          });
        }

        res.json({ 
          message: "School and admin account registered successfully", 
          schoolId, 
          userId: this.lastID 
        });
      });
    });
  } catch (hashErr) {
    console.error("Server error during registration:", hashErr);
    res.status(500).json({ error: "Internal server error" });
  }
});

// API: Login with Role and Allocation Restrictions

app.post("/api/login", async (req, res) => {
  const rawEmail = req.body.email || req.body.username;
  const rawPassword = req.body.password;
  const selectedRole = req.body.role || req.body.selectedRole;

  if (!rawEmail || !rawPassword) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const cleanEmail = rawEmail.trim().toLowerCase();
  const cleanPassword = rawPassword.trim();

  // FIX: Removed u.school_id since the users table doesn't have it, 
  // or added a fallback/null if your schema needs it.
  const sql = `
    SELECT 
      u.id, 
      u.full_name, 
      u.role, 
      u.password_hash 
    FROM users u 
    WHERE LOWER(u.email) = ?
  `;

  db.get(sql, [cleanEmail], async (err, user) => {
    if (err) {
      console.error("Database error during login:", err);
      return res.status(500).json({ error: "Internal server error" });
    }

    if (!user) {
      return res.status(401).json({ error: "Invalid username/email or password" });
    }

    try {
      let isPasswordValid = await bcrypt.compare(cleanPassword, user.password_hash);
      if (!isPasswordValid && user.password_hash === cleanPassword) {
        isPasswordValid = true;
      }

      if (!isPasswordValid) {
        return res.status(401).json({ error: "Invalid username/email or password" });
      }

      const activeRole = selectedRole || user.role;

      // Role authorization check
      if (selectedRole) {
        const dbRole = (user.role || "").trim().toLowerCase().replace(/[\s_]+/g, '');
        const inputRole = selectedRole.trim().toLowerCase().replace(/[\s_]+/g, '');

        const isSuperAdmin = dbRole.includes('superadmin');
        const isMatchingRole = dbRole === inputRole || dbRole.includes(inputRole) || inputRole.includes(dbRole);

        if (!isSuperAdmin && !isMatchingRole) {
          return res.status(403).json({ 
            error: `Access denied: You are not authorized for the '${selectedRole}' role.` 
          });
        }
      }

      // Helper function for session setup
      function completeLogin(currentUser, assignedRole) {
        const finalRole = (currentUser.role && currentUser.role.toLowerCase() === 'super admin') ? 'Super Admin' : (assignedRole || currentUser.role);

        req.session.user = {
          id: currentUser.id,
          email: currentUser.email,
          fullName: currentUser.full_name,
          activeRole: finalRole,
          schoolId: null
        };

        req.session.save((saveErr) => {
          if (saveErr) {
            console.error("Session save error:", saveErr);
            return res.status(500).json({ error: "Internal server error during session creation" });
          }

          let redirectUrl = '/dashboard/subject-teacher';
          const roleLower = finalRole.toLowerCase();

          if (roleLower.includes('super admin')) {
            redirectUrl = '/dashboard/super-admin';
          } else if (roleLower.includes('school admin') || roleLower.includes('admin')) {
            redirectUrl = '/dashboard/admin';
          } else if (roleLower.includes('class teacher')) {
            redirectUrl = '/dashboard/class-teacher';
          }

          return res.json({ 
            success: true, 
            message: "Login successful", 
            redirectUrl: redirectUrl,
            user: {
              id: currentUser.id,
              full_name: currentUser.full_name,
              role: finalRole,
              school_id: null,
              school_name: "School Portal"
            }
          });
        });
      }

      // Class Teacher allocation check
      if (activeRole && activeRole.toLowerCase() === 'class teacher') {
        db.get("SELECT * FROM class_teacher_allocations WHERE teacher_id = ?", [user.id], (allocErr, allocation) => {
          if (allocErr) {
            console.error("Error checking class allocation:", allocErr);
            return res.status(500).json({ error: "Internal server error during authorization check" });
          }

          if (!allocation) {
            return res.status(403).json({ 
              error: "Access denied: You are not assigned as a Class Teacher for any stream." 
            });
          }

          return completeLogin(user, activeRole);
        });
      } else {
        return completeLogin(user, activeRole);
      }

    } catch (bcryptErr) {
      console.error("Error during authentication processing:", bcryptErr);
      return res.status(500).json({ error: "Internal server error" });
    }
  });
});

// 1. Super Admin Dashboard Route
app.get('/dashboard/super-admin', requireRole(['Super Admin']), (req, res) => {
    res.sendFile(path.join(__dirname, '/public/super-admin.html'));
});

// 2. School Admin Dashboard Route
app.get('/dashboard/admin', requireRole(['School Admin', 'Super Admin']), (req, res) => {
    res.sendFile(path.join(__dirname, '/public/dashboard.html'));
});

// 3. Class Teacher Dashboard Route
app.get('/dashboard/class-teacher', requireRole(['Class Teacher', 'class_teacher', 'classteacher', 'Super Admin']), (req, res) => {
    res.sendFile(path.join(__dirname, '/public/class-teacher-dashboard.html'));
});

// Subject Teacher Dashboard
app.get('/dashboard/subject-teacher', requireRole(['Subject Teacher', 'Teacher', 'teacher', 'class teacher', 'class_teacher', 'Super Admin']), (req, res) => {
    res.sendFile(path.join(__dirname, '/public/teacher-dashboard.html'));
});

// API: Forgot Password
app.post("/api/forgot-password", async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email address is required" });
  }

  const cleanEmail = email.trim().toLowerCase();

  // 1. Verify user existence in database
  const sql = `SELECT id, full_name, email FROM users WHERE LOWER(email) = ?`;

  db.get(sql, [cleanEmail], async (err, user) => {
    if (err) return res.status(500).json({ error: err.message });

    if (!user) {
      return res.status(404).json({ error: "No account found with this email address." });
    }

    // 2. Generate temporary password
    const tempPassword = "Password123"; // Or generate a random string

    try {
      // 3. Hash the temporary password before saving to DB
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(tempPassword, saltRounds);

      const updateSql = `UPDATE users SET password_hash = ? WHERE id = ?`;

      db.run(updateSql, [hashedPassword, user.id], (updateErr) => {
        if (updateErr) return res.status(500).json({ error: updateErr.message });

        res.json({
          message: `Password reset successfully. Your temporary password is: ${tempPassword}`
        });
      });
    } catch (hashErr) {
      return res.status(500).json({ error: "Failed to process password reset" });
    }
  });
});
// ==========================================
// API: Super Admin Routes
// ==========================================

// 1. GET: Fetch all schools
app.get("/api/super-admin/schools", (req, res) => {
  const sql = `SELECT * FROM schools ORDER BY id DESC`;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 2. POST: Register a new school
app.post("/api/super-admin/schools", (req, res) => {
  const { name, center_number } = req.body;
  if (!name || !center_number) {
    return res.status(400).json({ error: "School name and center number are required." });
  }

  const sql = `INSERT INTO schools (name, center_number) VALUES (?, ?)`;
  db.run(sql, [name, center_number], function (err) {
    if (err) {
      if (err.message.includes("UNIQUE constraint failed")) {
        return res.status(400).json({ error: "A school with this center number already exists." });
      }
      return res.status(500).json({ error: err.message });
    }
    res.status(201).json({ id: this.lastID, name, center_number });
  });
});

// 3. POST: Register a School Admin
app.post("/api/super-admin/school-admins", (req, res) => {
  const { school_id, full_name, email, password } = req.body;
  if (!school_id || !full_name || !email || !password) {
    return res.status(400).json({ error: "All fields are required." });
  }

  const sql = `INSERT INTO users (school_id, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, 'school_admin')`;
  db.run(sql, [school_id, full_name, email, password], function (err) {
    if (err) {
      if (err.message.includes("UNIQUE constraint failed")) {
        return res.status(400).json({ error: "An account with this email already exists." });
      }
      return res.status(500).json({ error: err.message });
    }
    res.status(201).json({ id: this.lastID, message: "School Admin registered successfully." });
  });
});
// API: Classes
app.post("/api/schools/:schoolId/classes", (req, res) => {
  const { schoolId } = req.params;
  const { name, level, max_subjects } = req.body;

  if (!schoolId || schoolId === "undefined" || schoolId === "null") {
    return res.status(400).json({ error: "Invalid School ID provided." });
  }

  if (!name || !level) {
    return res.status(400).json({ error: "Class name and level are required." });
  }

  db.run(
    `INSERT INTO classes (school_id, name, level, max_subjects) VALUES (?, ?, ?, ?)`,
    [schoolId, name, level, max_subjects || 10],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Class created successfully", classId: this.lastID });
    }
  );
});

// 1. Fetch Classes for a Specific School
app.get('/api/schools/:schoolId/classes', (req, res) => {
  const { schoolId } = req.params;
  const sql = `
    SELECT 
      c.id,
      c.school_id,
      c.name,
      c.level
    FROM classes c
    WHERE c.school_id = ?
    ORDER BY c.id DESC
  `;

  db.all(sql, [schoolId], (err, rows) => {
    if (err) {
      console.error('Database query error in /classes:', err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows || []);
  });
});
// Assign or Update Class Teacher (Fixed to validate school context)
app.post('/api/schools/:schoolId/classes/assign-teacher', (req, res) => {
  const { schoolId } = req.params;
  const { class_id, teacher_id } = req.body;

  if (!class_id || !teacher_id) {
    return res.status(400).json({ error: 'Both class selection and teacher selection are required.' });
  }

  // Constrain update statement using schoolId isolation match
  const sql = `UPDATE classes SET class_teacher_id = ? WHERE id = ? AND school_id = ?`;

  db.run(sql, [teacher_id, class_id, schoolId], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    if (this.changes === 0) return res.status(404).json({ error: "Class not found or does not belong to this school." });
    res.json({ message: 'Class Teacher assigned successfully!' });
  });
});

// API: Meta Dropdowns (Fixed to support tenant filters)
app.get("/api/meta", (req, res) => {
  const schoolId = req.query.school_id;

  db.all("SELECT id, name FROM schools", [], (err, schools) => {
    if (err) return res.status(500).json({ error: err.message });

    // Filter classes to avoid cross-tenant structural leakage if school context is supplied
    const classSql = schoolId ? "SELECT id, name FROM classes WHERE school_id = ?" : "SELECT id, name FROM classes";
    const classParams = schoolId ? [schoolId] : [];

    db.all(classSql, classParams, (err, classes) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ schools: schools || [], classes: classes || [] });
    });
  });
});

// API: Record Marks (Sanitized & Completed Fragment Loop)
app.post("/api/schools/:schoolId/marks", (req, res) => {
  const schoolId = parseInt(req.params.schoolId) || 1;
  const { subject_id, term, year, assessment_type, max_score, marks } = req.body;

  if (!subject_id || !marks || !Array.isArray(marks)) {
    return res.status(400).json({ error: "Missing required fields or invalid marks array." });
  }

  const cleanTermVal = cleanTerm(term);
  const cleanYearVal = parseInt(year) || 2026;
  const cleanType = cleanAssessmentType(assessment_type);

  const getSubjectSql = isNaN(subject_id)
    ? `SELECT id FROM subjects WHERE school_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?))`
    : `SELECT id FROM subjects WHERE id = ? AND school_id = ?`;

  const subjectParams = isNaN(subject_id) ? [schoolId, subject_id] : [subject_id, schoolId];

  db.get(getSubjectSql, subjectParams, (err, subjectRow) => {
    if (err) return res.status(500).json({ error: err.message });
    const realSubjectId = subjectRow ? subjectRow.id : (parseInt(subject_id) || 1);
    
    const findSql = `SELECT id FROM assessments WHERE school_id = ? AND subject_id = ? AND term = ? AND year = ? AND assessment_type = ?`;
    db.get(findSql, [schoolId, realSubjectId, cleanTermVal, cleanYearVal, cleanType], (err, row) => {
      if (err) return res.status(500).json({ error: err.message });

      // If assessment configuration doesn't exist, create it inside the school's context
      if (!row) {
        const createAssessmentSql = `INSERT INTO assessments (school_id, subject_id, term, year, assessment_type, max_score) VALUES (?, ?, ?, ?, ?, ?)`;
        db.run(createAssessmentSql, [schoolId, realSubjectId, cleanTermVal, cleanYearVal, cleanType, max_score || 3.0], function(err) {
          if (err) return res.status(500).json({ error: err.message });
          saveStudentMarks(this.lastID);
        });
      } else {
        saveStudentMarks(row.id);
      }

      function saveStudentMarks(assessmentId) {
        const markSql = `
          INSERT INTO marks (student_id, assessment_id, score)
          VALUES (?, ?, ?)
          ON CONFLICT(student_id, assessment_id) 
          DO UPDATE SET score = excluded.score
        `;
        const stmt = db.prepare(markSql);
        db.serialize(() => {
          marks.forEach(item => {
            if (item.score !== null && item.score !== undefined && item.student_id) {
              stmt.run([item.student_id, assessmentId, item.score]);
            }
          });
          stmt.finalize();
          res.json({ message: "Marks recorded successfully!" });
        });
      }
    });
  });
});

// Helper to categorize grades, descriptors, and teacher comments
function getGradeDetails(score) {
  if (score >= 80) return { grade: 'A*', descriptor: 'Achieved High Distinction', comment: 'Exceptional performance across all competence areas.' };
  if (score >= 70) return { grade: 'A', descriptor: 'Achieved Distinction', comment: 'Demonstrates outstanding understanding and application.' };
  if (score >= 60) return { grade: 'B', descriptor: 'Achieved Credit', comment: 'Good understanding and competent application.' };
  if (score >= 50) return { grade: 'C', descriptor: 'Achieved Pass', comment: 'Satisfactory understanding; meets basic requirements.' };
  if (score >= 40) return { grade: 'D', descriptor: 'Achieved Elementary', comment: 'Basic competence shown; needs focused support.' };
  return { grade: 'E', descriptor: 'Not Achieved', comment: 'Requires substantial guidance and remedial effort.' };
}

// POST: Route to trigger report card generation using generate-report-card.js
app.post('/api/generate-reports', (req, res) => {
  console.log("Generate request body:", req.body);

  const schoolId = parseInt(req.body.school_id, 10) || 1;
  const term = typeof cleanTerm === 'function' ? cleanTerm(req.body.term) : (parseInt(req.body.term, 10) || 1);
  const year = req.body.year ? parseInt(req.body.year, 10) : 2026;
  const className = req.body.class_name || null;

  calculateReports(db, { schoolId, term, year, className }, (err, studentList) => {
    if (err) {
      console.error("Calculation Error:", err);
      return res.status(500).json({ error: err.message || "Failed to calculate report cards." });
    }

    const reportCount = Array.isArray(studentList) ? studentList.length : 0;
    console.log(`Generated ${reportCount} report cards.`);
    
    return res.status(200).json({ 
      success: true, 
      count: reportCount,
      message: `Successfully generated ${reportCount} report cards.`
    });
  });
});

app.all("/api/reports", (req, res) => {
  try {
    const body = req.body || {};
    const params = req.query || {};

    const schoolId = parseInt(
      body.school_id || params.school_id ||
      body.schoolId || params.schoolId, 10
    ) || 1;

    // Bulletproof term sanitization to catch "1:1" or duplicate values
    const rawTermInput = String(body.term || params.term || "1");
    const rawTerm = rawTermInput.split(/[:-_]/)[0];
    const cleanTermStr = String(rawTerm).replace(/\D/g, "") || "1";
    const termNum = parseInt(cleanTermStr, 10) || 1;
    const termNameStr = `Term ${termNum}`;

    const studentId =
      body.student_id || params.student_id ||
      body.studentId || params.studentId || null;

    const classVal =
      body.class_id || params.class_id ||
      body.classId || params.classId ||
      body.class_name || params.class_name ||
      body.class || params.class ||
      body.classval || params.classval ||
      body.classVal || params.classVal ||
      body.class_value || params.class_value;

    console.log("REPORT CARD DEBUG:", {
      body: body,
      params: params,
      termNum: termNum,
      classVal: classVal
    });

    // 0. Fetch school-wide term settings (closing date, opening date, next term fees)
    db.get(
      `SELECT closing_date, next_term_opening_date, default_next_term_fees 
       FROM school_term_settings 
       WHERE school_id = ? AND (term_name = ? OR term_name LIKE ?) 
       LIMIT 1`,
      [schoolId, termNameStr, `%Term ${termNum}%`],
      (termErr, termSettings) => {
        if (termErr) {
          console.warn("Could not fetch school term settings:", termErr);
        }

        const closingDate = (termSettings && termSettings.closing_date) || '';
        const openingDate = (termSettings && termSettings.next_term_opening_date) || '';
        const defaultFeesNext = (termSettings && termSettings.default_next_term_fees) || 0;

        // 1. Fetch all subjects for this school so we can pre-populate blank report rows
        db.all(`SELECT id, name FROM subjects WHERE school_id = ?`, [schoolId], (subErr, subjectsRows) => {
          if (subErr) {
            console.warn("Could not fetch subjects list for blank reports:", subErr);
          }
          const allSchoolSubjects = subjectsRows || [];

        // 2. Query matching students, subjects, marks, and dynamic term settings
         let query = `
            SELECT
              st.id AS student_id,
              st.full_name AS student_name,
              st.gender,
              c.name AS class_name,
              sub.id AS subject_id,
              sub.name AS subject_name,
              rm.exam_type AS assessment_type,
              rm.score,
              sch.name AS school_name,
              COALESCE(t.full_name, '-') AS subject_teacher,
              0 AS fees_balance,
              COALESCE(ts.default_next_term_fees, 0) AS fees_next_term,
              COALESCE(ts.closing_date, '-') AS term_ended_on,
              COALESCE(ts.next_term_opening_date, '-') AS next_term_begins
            FROM students st
            JOIN classes c ON st.class_id = c.id
            JOIN schools sch ON st.school_id = sch.id
            CROSS JOIN subjects sub ON sub.school_id = st.school_id
            LEFT JOIN teacher_allocations ta ON ta.school_id = st.school_id 
              AND ta.class_id = st.class_id 
              AND ta.subject_id = sub.id
            LEFT JOIN users t ON ta.teacher_id = t.id
            LEFT JOIN marks rm ON rm.student_id = st.id 
              AND rm.subject_id = sub.id 
              AND rm.term = ?
            LEFT JOIN school_term_settings ts ON ts.school_id = st.school_id 
              AND (
                ts.term_name = ? 
                OR LOWER(TRIM(ts.term_name)) LIKE ?
              )
            WHERE st.school_id = ? AND st.class_id = ?
          `;

          const sqlParams = [
            termNum,                  // For rm.term
            termNum,                  // For ts.term_name exact match
            `%${termNum}%`,           // For ts.term_name LIKE match
            schoolId,                 // For WHERE st.school_id
            classVal                   // For WHERE st.class_id
          ];

          // Filter by student or class
          if (
            studentId !== null &&
            String(studentId).trim() !== "" &&
            !["null", "undefined"].includes(
              String(studentId).toLowerCase()
            )
          ) {
            const id = parseInt(studentId, 10);

            if (!Number.isInteger(id) || id <= 0) {
              return res.status(400).json({
                error: "Invalid student ID."
              });
            }

            query += ` AND st.id = ?`;
            sqlParams.push(id);

          } else if (
            classVal !== undefined &&
            !["all classes", "all", "undefined", "null", ""]
              .includes(String(classVal).trim().toLowerCase())
          ) {
            const cleanClassVal = String(classVal)
              .replace(/^:/, "")
              .trim();

            if (/^\d+$/.test(cleanClassVal)) {
              query += ` AND st.class_id = ?`;
              sqlParams.push(parseInt(cleanClassVal, 10));
            } else {
              query += `
                AND (CAST(c.id AS TEXT) = ? OR LOWER(TRIM(c.name)) = LOWER(TRIM(?)) OR LOWER(c.name) LIKE LOWER(?))
              `;
              sqlParams.push(cleanClassVal, cleanClassVal, `%${cleanClassVal}%`);
            }
          }

          db.all(query, sqlParams, (err, rows) => {
            if (err) {
              console.error("Database Error in /api/reports:", err);
              return res.status(500).json({
                error: "Failed to query mark records.",
                details: err.message
              });
            }

            if (!rows || rows.length === 0) {
              return res.json([]);
            }

            const reports = {};

            rows.forEach((row) => {
              if (!reports[row.student_id]) {
                reports[row.student_id] = {
                  student_id: row.student_id,
                  student_name: row.student_name,
                  gender: row.gender,
                  class_name: row.class_name,
                  school_name: row.school_name,
                  term_ended_on: row.term_ended_on || closingDate,
                  next_term_begins: row.next_term_begins || openingDate,
                  fees_balance: row.fees_balance,
                  fees_next_term: row.fees_next_term,
                  subjects: {}
                };
              
                allSchoolSubjects.forEach((sub) => {
                  reports[row.student_id].subjects[sub.name] = {
                    formativeEntries: [],
                    summativeScore: 0,
                    summativeMax: 80,
                    hasSummative: false,
                    teacherName: '-'
                  };
                });
              }

              const student = reports[row.student_id];
              if (!row.subject_name) return;

              const subjectName = row.subject_name;

              if (!student.subjects[subjectName]) {
                student.subjects[subjectName] = {
                  formativeEntries: [],
                  summativeScore: 0,
                  summativeMax: 80,
                  hasSummative: false
                };
              }

              const subject = student.subjects[subjectName];

              if (row.subject_teacher) {
                subject.teacherName = row.subject_teacher;
              }

              const type = String(row.assessment_type || "").trim().toLowerCase();
              const score = Number(row.score);

              if (!Number.isFinite(score)) return;

              if (type === "a1" || type === "chapter 1") {
                subject.a1 = score;
              } else if (type === "a2" || type === "chapter 2") {
                subject.a2 = score;
              } else if (type === "a3" || type === "chapter 3") {
                subject.a3 = score;
              } else if (type.includes("formative") || type.includes("activity") || type.includes("aoi") || type === "f") {
                subject.formativeEntries.push({ score, max: 20 });
              } else {
                subject.summativeScore = score;
                subject.hasSummative = true;
              }
            });

            const studentList = Object.values(reports);

            studentList.forEach((student) => {
              let totalSubjects = 0;
              let totalPercentageSum = 0;

              Object.values(student.subjects).forEach((subject) => {
                const a1Val = (subject.a1 !== undefined && !isNaN(subject.a1)) ? subject.a1 : null;
                const a2Val = (subject.a2 !== undefined && !isNaN(subject.a2)) ? subject.a2 : null;
                const a3Val = (subject.a3 !== undefined && !isNaN(subject.a3)) ? subject.a3 : null;

                const chapterScores = [a1Val, a2Val, a3Val].filter(s => s !== null);
                const chapterAvg = chapterScores.length > 0 
                  ? (chapterScores.reduce((a, b) => a + b, 0) / chapterScores.length)
                  : null;

                subject.a1 = a1Val !== null ? a1Val : undefined;
                subject.a2 = a2Val !== null ? a2Val : undefined;
                subject.a3 = a3Val !== null ? a3Val : undefined;
                subject.avg = chapterAvg !== null ? Number(chapterAvg.toFixed(1)) : '-';

                let formative20 = 0;

                if (chapterAvg !== null) {
                  // Automatically convert A1/A2/A3 average (scored out of 3) into the 20% scale
                  formative20 = (chapterAvg / 3) * 20;
                } else if (subject.formativeEntries.length > 0) {
                  // Fallback to manual formative total if entered directly
                  const sum = subject.formativeEntries.reduce((total, entry) => total + entry.score, 0);
                  formative20 = sum;
                }

                const summative80 = subject.hasSummative ? subject.summativeScore : 0;
                const finalScore = Math.max(0, Math.min(100, Math.round(formative20 + summative80)));

                let descriptor = "Minimum";
                if (finalScore >= 80) descriptor = "Outstanding";
                else if (finalScore >= 65) descriptor = "High";
                else if (finalScore >= 50) descriptor = "Moderate";
                else if (finalScore >= 35) descriptor = "Basic";

                subject.formative_20 = formative20 > 0 ? formative20.toFixed(1) : '-';
                subject.summative_80 = summative80 > 0 ? summative80.toFixed(1) : '-';
                subject.finalScore = finalScore;
                subject.descriptor = descriptor;

                totalPercentageSum += finalScore;
                totalSubjects++;
              });

              student.subjectCount = totalSubjects;
              student.avgPercentage = totalSubjects > 0 ? (totalPercentageSum / totalSubjects).toFixed(1) : "0.0";
            });

            studentList.sort((a, b) => parseFloat(b.avgPercentage) - parseFloat(a.avgPercentage));
            studentList.forEach((student, index) => {
              student.rank = index + 1;
            });

            return res.json(studentList);
          });
        });
      }
    );

  } catch (error) {
    console.error("Unexpected error in /api/reports:", error);
    return res.status(500).json({
      error: "Unexpected error generating reports.",
      details: error.message
    });
  }
});
app.post('/api/schools/:schoolId/record-marks', (req, res) => {
  const schoolId = parseInt(req.params.schoolId, 10);
  const { classId, subjectId, examType, term, marksData, dataToSave: incomingData } = req.body;

  const parsedClassId = parseInt(classId, 10);
  const parsedSubjectId = parseInt(subjectId, 10);
  const finalExamType = examType || 'Formative';
  const dataToSave = marksData || incomingData || [];

  // Filter out invalid/empty scores first
  const validEntries = dataToSave.filter(
    e => e.score !== '' && e.score !== null && e.score !== undefined
  );

  if (validEntries.length === 0) {
    return res.json({ message: "No scores to save." });
  }

  const sql = `
    INSERT INTO marks (school_id, class_id, subject_id, student_id, exam_type, term, score)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(student_id, subject_id, exam_type, term)
    DO UPDATE SET score = excluded.score
  `;

  db.serialize(() => {
    db.run("BEGIN TRANSACTION;");

    const stmt = db.prepare(sql);
    let errorOccurred = false;
    let completed = 0;

    validEntries.forEach(entry => {
      const studentId = parseInt(entry.studentId || entry.student_id || entry.id, 10);
      const score = parseFloat(entry.score);

      // Debug log to verify incoming parameters before insertion
      console.log('Inserting row params:', { schoolId, parsedClassId, parsedSubjectId, studentId, finalExamType, term, score });

      stmt.run([schoolId, parsedClassId, parsedSubjectId, studentId, finalExamType, term, score], function (err) {
        if (err) {
          console.error("Error inserting row:", err.message);
          errorOccurred = true;
        }

        completed++;

        // Once all rows are processed, finalize and commit/rollback
        if (completed === validEntries.length) {
          stmt.finalize();

          if (errorOccurred) {
            db.run("ROLLBACK;");
            return res.status(500).json({ error: "Failed to record marks." });
          } else {
            db.run("COMMIT;", (commitErr) => {
              if (commitErr) {
                return res.status(500).json({ error: "Failed to commit transaction." });
              }
              res.json({ message: "Marks saved successfully!" });
            });
          }
        }
      });
    });
  });
});

// API: Teachers & Subjects
app.post("/api/schools/:schoolId/subjects", (req, res) => {
  const { name, code } = req.body;
  if (!name) return res.status(400).json({ error: "Subject name is required." });
  db.run(`INSERT INTO subjects (school_id, name, code) VALUES (?, ?, ?)`, [req.params.schoolId, name, code || null], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Subject added successfully", subjectId: this.lastID });
  });
});

// GET: Fetch subjects specific to a school
app.get('/api/schools/:schoolId/subjects', (req, res) => {
  const { schoolId } = req.params;

  const sql = `SELECT * FROM subjects WHERE school_id = ? ORDER BY id DESC`;

  db.all(sql, [schoolId], (err, rows) => {
    if (err) {
      console.error('Error fetching subjects:', err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});


// POST: Bul// POST: Enroll a single student for a school
app.post('/api/schools/:schoolId/students', (req, res) => {
    const { schoolId } = req.params;
    const { class_id, full_name, lin, gender } = req.body;

    if (!full_name || !class_id || !gender) {
        return res.status(400).json({ error: 'Full name, class, and gender selection required.' });
    }

    const sql = `
        INSERT INTO students (school_id, class_id, full_name, lin, gender)
        VALUES (?, ?, ?, ?, ?)
    `;

    db.run(sql, [schoolId, class_id, full_name, lin || null, gender], function(err) {
        if (err) {
            console.error('Error enrolling student:', err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: 'Student enrolled successfully', studentId: this.lastID });
    });
});
// POST: Bulk upload students via CSV for a school
app.post('/api/schools/:schoolId/students/bulk', (req, res) => {
  const { schoolId } = req.params;
  const { class_id, students } = req.body; // Array of { full_name, lin }

  if (!class_id || !Array.isArray(students) || students.length === 0) {
    return res.status(400).json({ error: 'Class selection and student list are required.' });
  }

  const stmt = db.prepare(`INSERT INTO students (school_id, class_id, full_name, lin) VALUES (?, ?, ?, ?)`);

  db.serialize(() => {
    students.forEach(s => {
      if (s.full_name) {
        stmt.run(schoolId, class_id, s.full_name, s.lin || null);
      }
    });
    stmt.finalize(err => {
      if (err) {
        console.error('Error bulk inserting students:', err.message);
        return res.status(500).json({ error: err.message });
      }
      res.json({ message: `${students.length} students uploaded successfully` });
    });
  });
});

// GET: Fetch enrolled students specific to a school
app.get('/api/schools/:schoolId/students', (req, res) => {
  const { schoolId } = req.params;

  const sql = `
    SELECT 
      st.id, 
      st.full_name, 
      st.lin,
      st.gender, 
      c.name AS class_name 
    FROM students st
    JOIN classes c ON st.class_id = c.id
    WHERE st.school_id = ?
    ORDER BY st.id DESC
  `;

  db.all(sql, [schoolId], (err, rows) => {
    if (err) {
      console.error('Error fetching students:', err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});
// GET: Fetch teachers specific to a school
app.get('/api/schools/:schoolId/teachers', (req, res) => {
  const { schoolId } = req.params;

  const sql = `
    SELECT id, full_name, email, role 
    FROM users 
    WHERE school_id = ? AND role = 'teacher' 
    ORDER BY id DESC
  `;

  db.all(sql, [schoolId], (err, rows) => {
    if (err) {
      console.error('Error fetching teachers:', err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// POST: Register a new teacher for a school
app.post('/api/schools/:schoolId/teachers', (req, res) => {
  const { schoolId } = req.params;
  const { full_name, email, password } = req.body;

  if (!full_name || !email || !password) {
    return res.status(400).json({ error: 'Full name, email, and password are required.' });
  }

  const sql = `
    INSERT INTO users (school_id, full_name, email, password_hash, role) 
    VALUES (?, ?, ?, ?, 'teacher')
  `;

  db.run(sql, [schoolId, full_name, email, password], function(err) {
    if (err) {
      console.error('Error registering teacher:', err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: 'Teacher registered successfully', teacherId: this.lastID });
  });
});


// POST: Assign teacher to class and subject for a school
app.post('/api/schools/:schoolId/allocations', (req, res) => {
  const { teacher_id, class_id, subject_id } = req.body;

  if (!teacher_id || !class_id || !subject_id) {
    return res.status(400).json({ error: 'Teacher, class, and subject selections are required.' });
  }

  const sql = `
    INSERT INTO teacher_allocations (teacher_id, class_id, subject_id)
    VALUES (?, ?, ?)
  `;

  db.run(sql, [teacher_id, class_id, subject_id], function(err) {
    if (err) {
      console.error('Error creating allocation:', err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: 'Teacher allocated successfully', allocationId: this.lastID });
  });
});
app.post('/api/assign-class-teacher', (req, res) => {
  const { classId, teacherId, class_id, teacher_id } = req.body;

  const targetClassId = classId || class_id;
  const targetTeacherId = teacherId || teacher_id;

  if (!targetClassId || !targetTeacherId) {
    return res.status(400).json({ error: "Missing classId or teacherId" });
  }

  const query = `
    UPDATE classes 
    SET teacher_id = ?, class_teacher_id = ? 
    WHERE id = ?
  `;

  db.run(query, [targetTeacherId, targetTeacherId, targetClassId], function(err) {
    if (err) {
      console.error("Error updating class teacher:", err);
      return res.status(500).json({ error: "Database update failed" });
    }

    res.json({ success: true, message: "Class teacher assigned successfully!" });
  });
});
// POST: Assign Class Teacher to a Class
app.post('/api/schools/:schoolId/classes/assign-teacher', (req, res) => {
    const { schoolId } = req.params;
    const { class_id, teacher_id, classId, teacherId } = req.body;

    // Handle both payload naming conventions (snake_case vs camelCase)
    const targetClassId = class_id || classId;
    const targetTeacherId = teacher_id || teacherId;

    if (!targetClassId || !targetTeacherId) {
        return res.status(400).json({ error: "Please select both a class and a teacher." });
    }

    // Update BOTH teacher_id and class_teacher_id to prevent column mismatch bugs
    const sql = `
        UPDATE classes 
        SET class_teacher_id = ?, teacher_id = ? 
        WHERE id = ? AND school_id = ?
    `;

    db.run(sql, [targetTeacherId, targetTeacherId, targetClassId, schoolId], function(err) {
        if (err) {
            console.error("Assign teacher DB error:", err.message);
            return res.status(500).json({ error: err.message });
        }

        res.json({ success: true, message: "Class teacher assigned successfully." });
    });
});
// POST Assign Subject Teacher
app.post('/api/allocations/assign-subject', (req, res) => {
  const { schoolId, teacherId, classId, subjectId } = req.body;

  if (!schoolId || !teacherId || !classId || !subjectId) {
    return res.status(400).json({ error: "All fields are required." });
  }

  const sql = `
    INSERT INTO teacher_allocations (school_id, teacher_id, class_id, subject_id)
    VALUES (?, ?, ?, ?)
  `;

  db.run(sql, [schoolId, teacherId, classId, subjectId], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: "Subject teacher assigned successfully!", allocationId: this.lastID });
  });
});

// GET: Retrieve all allocations/assignments for a specific school
app.get('/api/schools/:schoolId/assignments', (req, res) => {
  const { schoolId } = req.params;

  const query = `
    SELECT 
      ta.id AS allocation_id,
      ta.teacher_id,
      ta.class_id,
      ta.subject_id,
      u.full_name AS teacher_name,
      c.name AS class_name,
      s.name AS subject_name
    FROM teacher_allocations ta
    JOIN users u ON ta.teacher_id = u.id
    JOIN classes c ON ta.class_id = c.id
    JOIN subjects s ON ta.subject_id = s.id
    WHERE ta.school_id = ?
  `;

  db.all(query, [schoolId], (err, rows) => {
    if (err) {
      console.error('Error fetching allocations:', err.message);
      return res.status(500).json({
        error: 'Database error: ' + err.message
      });
    }

    res.json(rows);
  });
});

// GET Teachers for a School
app.get('/api/schools/:schoolId/teachers', (req, res) => {
  const schoolId = req.params.schoolId;
  const sql = `SELECT id, full_name, username FROM users WHERE school_id = ? AND role IN ('teacher', 'class_teacher', 'school_admin')`;
  db.all(sql, [schoolId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// GET Classes for a School
app.get('/api/schools/:schoolId/classes', (req, res) => {
  const schoolId = req.params.schoolId;
  const sql = `SELECT id, name FROM classes WHERE school_id = ?`;
  db.all(sql, [schoolId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// GET Subjects for a School
app.get('/api/schools/:schoolId/subjects', (req, res) => {
  const schoolId = req.params.schoolId;
  const sql = `SELECT id, name, code FROM subjects WHERE school_id = ?`;
  db.all(sql, [schoolId], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});
// GET: Fetch teacher allocations specific to a school
app.get('/api/schools/:schoolId/allocations', (req, res) => {
  const { schoolId } = req.params;

  const sql = `
    SELECT 
      a.id, 
      u.full_name AS teacher_name, 
      c.name AS class_name, 
      s.name AS subject_name 
    FROM teacher_allocations a
    JOIN users u ON a.teacher_id = u.id
    JOIN classes c ON a.class_id = c.id
    JOIN subjects s ON a.subject_id = s.id
    WHERE u.school_id = ?
    ORDER BY a.id DESC
  `;

  db.all(sql, [schoolId], (err, rows) => {
    if (err) {
      console.error('Error fetching allocations:', err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});
// 1. Get classes assigned to a specific class teacher
app.get('/api/schools/:schoolId/teachers/:teacherId/classes', (req, res) => {
    const { schoolId, teacherId } = req.params;
    const sql = `SELECT * FROM classes WHERE teacher_id = ? AND school_id = ?`;
    db.all(sql, [teacherId, schoolId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// 2. Get all students in a assigned class
app.get('/api/schools/:schoolId/classes/:classId/students', (req, res) => {
    const { schoolId, classId } = req.params;
    const sql = `SELECT * FROM students WHERE class_id = ? AND school_id = ?`;
    db.all(sql, [classId, schoolId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});
// PUT /api/schools/:schoolId/classes/:classId/assign-teacher
app.put('/api/schools/:schoolId/classes/:classId/assign-teacher', (req, res) => {
  const { schoolId, classId } = req.params;
  const { teacherId } = req.body;

  if (!teacherId) {
    return res.status(400).json({ error: "teacherId is required in request body" });
  }

  // Verify the user being assigned is actually a teacher at this school
  const verifyTeacherQuery = `
    SELECT id FROM users 
    WHERE id = ? AND school_id = ? AND role = 'teacher'
  `;

  db.get(verifyTeacherQuery, [teacherId, schoolId], (err, teacher) => {
    if (err) {
      console.error("Database error during verification:", err);
      return res.status(500).json({ error: "Database error occurred." });
    }

    if (!teacher) {
      return res.status(404).json({ error: "Teacher not found or does not belong to this school." });
    }

    // Update the class teacher assignment
    const updateQuery = `
      UPDATE classes 
      SET teacher_id = ? 
      WHERE id = ? AND school_id = ?
    `;

    db.run(updateQuery, [teacherId, classId, schoolId], function(err) {
      if (err) {
        console.error("Error updating class teacher:", err);
        return res.status(500).json({ error: "Failed to assign teacher." });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: "Class not found for this school." });
      }

      res.json({ 
        message: "Teacher assigned successfully", 
        schoolId: Number(schoolId), 
        classId: Number(classId), 
        teacherId: Number(teacherId) 
      });
    });
  });
});

// GET /api/schools/:schoolId/teachers
app.get('/api/schools/:schoolId/teachers', (req, res) => {
  const { schoolId } = req.params;

  const query = `
    SELECT id, full_name AS fullName, email 
    FROM users 
    WHERE school_id = ? AND role = 'teacher'
  `;

  db.all(query, [schoolId], (err, rows) => {
    if (err) {
      console.error("Error fetching teachers:", err);
      return res.status(500).json({ error: "Failed to load teachers." });
    }

    res.json(rows || []);
  });
});
app.put('/api/schools/:schoolId/classes/:classId/assign-teacher', (req, res) => {
    const { schoolId, classId } = req.params;
    const { teacherId } = req.body;

    if (!teacherId) {
        return res.status(400).json({ error: "Teacher ID is required." });
    }

    const sql = `UPDATE classes SET teacher_id = ? WHERE id = ? AND school_id = ?`;
    db.run(sql, [teacherId, classId, schoolId], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: "Class teacher assigned successfully." });
    });
});
// 3. Save / Update Class Teacher Remarks
app.put('/api/students/:studentId/remark', (req, res) => {
    const { studentId } = req.params;
    const { remark } = req.body;
    const sql = `UPDATE students SET class_teacher_remark = ? WHERE id = ?`;
    db.run(sql, [remark, studentId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ message: "Class Teacher remark updated." });
    });
});
// GET: Fetch all schools
app.get("/api/super-admin/schools", (req, res) => {
  const sql = `SELECT * FROM schools ORDER BY id DESC`;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Route for School Admin to update/insert term settings per school
app.post('/api/admin/term-settings', (req, res) => {
  let { 
    school_id,
    term_name, 
    closing_date, 
    next_term_opening_date, 
    default_next_term_fees 
  } = req.body;

  if (!school_id || !term_name) {
    return res.status(400).json({ success: false, message: 'school_id and term_name are required.' });
  }

  // Sanitize dates
  closing_date = closing_date ? new Date(closing_date).toISOString().split('T')[0] : null;
  next_term_opening_date = next_term_opening_date ? new Date(next_term_opening_date).toISOString().split('T')[0] : null;
  
  const parsedNextFees = (default_next_term_fees !== undefined && default_next_term_fees !== '') 
    ? parseFloat(default_next_term_fees) 
    : null;

  // 1. Try updating the existing settings row for this specific school and term
  const updateQuery = `
    UPDATE school_term_settings 
    SET closing_date = ?, next_term_opening_date = ?, default_next_term_fees = ?, updated_at = CURRENT_TIMESTAMP
    WHERE school_id = ? AND term_name = ?;
  `;

  db.run(updateQuery, [closing_date, next_term_opening_date, parsedNextFees, school_id, term_name], function(err) {
    if (err) {
      console.error('Error updating admin term settings:', err);
      return res.status(500).json({ success: false, message: 'Internal server error.' });
    }

    // 2. If no row existed, perform an insert
    if (this.changes === 0) {
      const insertQuery = `
        INSERT INTO school_term_settings (school_id, term_name, closing_date, next_term_opening_date, default_next_term_fees, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP);
      `;
      
      db.run(insertQuery, [school_id, term_name, closing_date, next_term_opening_date, parsedNextFees], function(insertErr) {
        if (insertErr) {
          console.error('Error inserting admin term settings:', insertErr);
          return res.status(500).json({ success: false, message: 'Internal server error.' });
        }
        return res.status(200).json({
          success: true,
          message: 'School term and fee settings created successfully.'
        });
      });
    } else {
      return res.status(200).json({
        success: true,
        message: 'School term and fee settings updated successfully.'
      });
    }
  });
});

// POST: Register a new school
app.post("/api/super-admin/schools", (req, res) => {
  const { name, center_number } = req.body;
  if (!name || !center_number) {
    return res.status(400).json({ error: "School name and center number are required." });
  }

  const sql = `INSERT INTO schools (name, center_number) VALUES (?, ?)`;
  db.run(sql, [name, center_number], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ id: this.lastID, name, center_number });
  });
});

// POST: Register a School Admin
app.post("/api/super-admin/school-admins", (req, res) => {
  const { school_id, full_name, email, password } = req.body;
  if (!school_id || !full_name || !email || !password) {
    return res.status(400).json({ error: "All fields are required." });
  }

  const sql = `INSERT INTO users (school_id, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, 'admin')`;
  db.run(sql, [school_id, full_name, email, password], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.status(201).json({ id: this.lastID, message: "School Admin registered successfully." });
  });
});
// API: Super Admin Inspect School Records
app.get("/api/super-admin/records", (req, res) => {
  const { school_id, type } = req.query;

  if (!school_id) {
    return res.status(400).json({ error: "School ID is required" });
  }

  let sql = "";

  switch (type) {
    case "teachers":
      sql = `SELECT id, full_name, email, role FROM users WHERE school_id = ? AND role IN ('teacher', 'class_teacher', 'admin')`;
      break;

    case "classes":
      sql = `SELECT * FROM classes WHERE school_id = ?`;
      break;

    case "students":
      // Fetch all columns directly to avoid column mismatch errors
      sql = `SELECT * FROM students WHERE school_id = ?`;
      break;

    case "allocations":
      sql = `
        SELECT 
          ta.id, 
          u.full_name AS teacher_name, 
          s.name AS subject_name, 
          c.name AS class_name 
        FROM teacher_allocations ta
        LEFT JOIN users u ON ta.teacher_id = u.id
        LEFT JOIN subjects s ON ta.subject_id = s.id
        LEFT JOIN classes c ON ta.class_id = c.id
        WHERE u.school_id = ?
      `;
      break;

    default:
      return res.status(400).json({ error: "Invalid record type specified" });
  }

  db.all(sql, [school_id], (err, rows) => {
    if (err) {
      console.error(`Database error fetching ${type}:`, err.message);
      return res.status(500).json({ error: err.message });
    }
    res.json(rows || []);
  });
});
// GET: Retrieve school details by school ID
app.get('/api/schools/:schoolId', (req, res) => {
  const { schoolId } = req.params;

  const query = `
    SELECT id, name, code, created_at 
    FROM schools 
    WHERE id = ?
  `;

  db.get(query, [schoolId], (err, school) => {
    if (err) {
      console.error('Error fetching school details:', err.message);
      return res.status(500).json({ error: 'Database error: ' + err.message });
    }
    if (!school) {
      return res.status(404).json({ error: 'School not found' });
    }
    res.json(school);
  });
});
app.get('/api/schools/:schoolId/class-teacher-info', (req, res) => {
  const { schoolId } = req.params;
  const { teacherId, classId } = req.query;

  let query = `
    SELECT 
      s.name AS schoolName,
      t.full_name AS teacherName,
      c.id AS classId,
      c.name AS className,
      c.level AS classLevel
    FROM users t
    JOIN schools s ON s.id = t.school_id
    LEFT JOIN classes c ON (
      (c.id = ?) OR 
      (c.teacher_id = t.id AND c.school_id = s.id) OR
      (c.class_teacher_id = t.id AND c.school_id = s.id)
    )
    WHERE t.id = ? AND s.id = ?
  `;

  const validClassId = (classId && classId !== 'null' && classId !== 'undefined') ? classId : null;
  const params = [validClassId, teacherId, schoolId];

  db.get(query, params, (err, row) => {
    if (err) {
      console.error("Database query error:", err);
      return res.status(500).json({ error: "Failed to load class info" });
    }

    if (!row) {
      return res.json({
        schoolName: "KAPKWATA SS",
        className: "No Assigned Class",
        teacherNames: "Unassigned",
        classId: null
      });
    }

    let formattedClassName = "No Assigned Class";
    if (row.className) {
      formattedClassName = row.classLevel ? `${row.className} (${row.classLevel})` : row.className;
    }

    res.json({
      schoolName: row.schoolName || "KAPKWATA SS",
      className: formattedClassName,
      teacherNames: row.teacherName || "Unassigned",
      classId: row.classId || null
    });
  });
});
app.post('/api/classes/:classId/attendance', (req, res) => {
  const { classId } = req.params;
  const { date, records } = req.body;

  if (!records || !Array.isArray(records)) {
    return res.status(400).json({ error: 'Invalid attendance data.' });
  }

  const stmt = db.prepare(`
    INSERT INTO attendance (class_id, student_id, date, status)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(class_id, student_id, date) DO UPDATE SET status = excluded.status
  `);

  records.forEach(r => {
    stmt.run(classId, r.student_id, date, r.status);
  });

  stmt.finalize((err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Attendance recorded successfully.' });
  });
});

// POST: Save Class Teacher Remarks
app.post('/api/students/:studentId/class-teacher-remark', (req, res) => {
  const { studentId } = req.params;
  const { remark } = req.body;

  const sql = `UPDATE students SET class_teacher_remark = ? WHERE id = ?`;

  db.run(sql, [remark, studentId], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: 'Class Teacher remark updated.' });
  });
});
// PUT (Edit) endpoints
app.put('/api/schools/:schoolId/classes/:id', (req, res) => {
    const { schoolId, id } = req.params;
    const { name, level } = req.body;
    const sql = `UPDATE classes SET name = ?, level = ? WHERE id = ? AND school_id = ?`;
    db.run(sql, [name, level, id, schoolId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Class not found" });
        res.json({ message: "Class updated successfully" });
    });
});

app.put('/api/schools/:schoolId/subjects/:id', (req, res) => {
    const { schoolId, id } = req.params;
    const { name, code } = req.body;
    const sql = `UPDATE subjects SET name = ?, code = ? WHERE id = ? AND school_id = ?`;
    db.run(sql, [name, code, id, schoolId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Subject not found" });
        res.json({ message: "Subject updated successfully" });
    });
});

app.put('/api/schools/:schoolId/teachers/:id', (req, res) => {
    const { schoolId, id } = req.params;
    const { full_name, email } = req.body;
    const sql = `UPDATE teachers SET full_name = ?, email = ? WHERE id = ? AND school_id = ?`;
    db.run(sql, [full_name, email, id, schoolId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Teacher not found" });
        res.json({ message: "Teacher updated successfully" });
    });
});

app.put('/api/schools/:schoolId/students/:id', (req, res) => {
    const { schoolId, id } = req.params;
    const { full_name, lin } = req.body;
    const sql = `UPDATE students SET full_name = ?, lin = ? WHERE id = ? AND school_id = ?`;
    db.run(sql, [full_name, lin, id, schoolId], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Student not found" });
        res.json({ message: "Student updated successfully" });
    });
});

app.put('/api/super-admin/schools/:id', (req, res) => {
  const { id } = req.params;
  const { name, center_number } = req.body;

  const sql = 'UPDATE schools SET name = ?, center_number = ? WHERE id = ?';
  db.run(sql, [name, center_number, id], function(err) {
    if (err) {
      console.error('Error updating school:', err);
      return res.status(500).json({ message: 'Database error' });
    }
    res.json({ message: 'School updated successfully' });
  });
});
// DELETE endpoints
app.delete('/api/schools/:schoolId/:type/:id', (req, res) => {
  const { schoolId, type, id } = req.params;
  const allowed = ['classes', 'subjects', 'teachers', 'students'];
  if (!allowed.includes(type)) return res.status(400).send("Invalid entity type");
  
  db.run(`DELETE FROM ${type} WHERE id = ? AND school_id = ?`, [id, schoolId], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Deleted successfully" });
  });
});
app.put('/api/schools/:schoolId/classes/:classId/assign-teacher', (req, res) => {
    const { schoolId, classId } = req.params;
    const { teacherId } = req.body;

    if (!teacherId) {
        return res.status(400).json({ error: "Teacher ID is required." });
    }

    const sql = `UPDATE classes SET teacher_id = ? WHERE id = ? AND school_id = ?`;
    db.run(sql, [teacherId, classId, schoolId], function(err) {
        if (err) {
            console.error("Assign teacher DB error:", err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json({ message: "Class teacher assigned successfully." });
    });
});
app.get('/api/schools/:schoolId/class-overview', async (req, res) => {
    try {
        const { schoolId } = req.params;
        const { teacherId, classId } = req.query;

        // If classId is missing or null, query the class assigned to this teacher directly from DB
        let targetClassId = classId;
        if (!targetClassId || targetClassId === 'null') {
            const [classRows] = await db.query(
                'SELECT id FROM classes WHERE class_teacher_id = ? AND school_id = ?',
                [teacherId, schoolId]
            );
            if (classRows.length > 0) {
                targetClassId = classRows[0].id;
            }
        }

        // Run your class overview queries safely using targetClassId...
        
    } catch (error) {
        console.error("Server Error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});
app.delete('/api/super-admin/schools/:id', (req, res) => {
  const { id } = req.params;

  const sql = 'DELETE FROM schools WHERE id = ?';
  db.run(sql, [id], function(err) {
    if (err) {
      console.error('Error deleting school:', err);
      return res.status(500).json({ message: 'Database error' });
    }
    res.json({ message: 'School deleted successfully' });
  });
});

// Create Contacts Table in SQLite
db.run(`
  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    FOREIGN KEY(school_id) REFERENCES schools(id)
  )
`);

// GET all contacts (for Super Admin)
app.get('/api/super-admin/contacts', (req, res) => {
  const query = `
    SELECT c.*, s.name AS school_name 
    FROM contacts c 
    LEFT JOIN schools s ON c.school_id = s.id 
    ORDER BY c.id DESC
  `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ contacts: rows });
  });
});

// POST new contact
app.post('/api/super-admin/contacts', (req, res) => {
  const { school_id, name, role, phone, email } = req.body;
  if (!name || !phone) {
    return res.status(400).json({ error: 'Name and Phone are required.' });
  }

  const query = `INSERT INTO contacts (school_id, name, role, phone, email) VALUES (?, ?, ?, ?, ?)`;
  db.run(query, [school_id || null, name, role || 'Staff', phone, email || ''], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, contactId: this.lastID });
  });
});
// 2. Initialize database schema (ADD IT HERE)
db.run(`
  CREATE TABLE IF NOT EXISTS marks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id INTEGER NOT NULL,
    class_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    student_id TEXT NOT NULL,
    exam_type TEXT NOT NULL,
    term TEXT NOT NULL,
    score REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_id, subject_id, exam_type, term)
  )
`, (err) => {
  if (err) {
    console.error("Error creating marks table:", err.message);
  } else {
    console.log("Marks table initialized successfully.");
  }
});
// Export report cards endpoint in server.js
app.get('/api/download-report-cards', async (req, res) => {
    try {
        const { schoolId, classId, term } = req.query;
        
        // Query your database for the class records if needed
        // const records = await db.query('SELECT * FROM report_cards WHERE class_id = ?', [classId]);

        res.status(200).json({
            success: true,
            message: "Report card export stream initialized successfully"
        });
    } catch (error) {
        console.error("Export error:", error);
        res.status(500).json({ success: false, error: "Failed to process download on server" });
    }
});

// Route to save or update term-end details and fees on a student's report
app.post('/api/reports/:reportId/term-details', async (req, res) => {
  try {
    const { reportId } = req.params;
    
    let { 
      closing_date, 
      next_term_opening_date, 
      fees_balance, 
      next_term_fees 
    } = req.body;

    closing_date = closing_date ? new Date(closing_date).toISOString().split('T')[0] : null;
    next_term_opening_date = next_term_opening_date ? new Date(next_term_opening_date).toISOString().split('T')[0] : null;
    
    let parsedFeesBalance = null;
    if (fees_balance !== undefined && fees_balance !== '' && fees_balance !== null) {
      parsedFeesBalance = parseFloat(fees_balance);
      if (isNaN(parsedFeesBalance)) {
        return res.status(400).json({ success: false, message: 'Invalid fees balance format.' });
      }
    }

    let parsedNextTermFees = null;
    if (next_term_fees !== undefined && next_term_fees !== '' && next_term_fees !== null) {
      parsedNextTermFees = parseFloat(next_term_fees);
      if (isNaN(parsedNextTermFees)) {
        return res.status(400).json({ success: false, message: 'Invalid next term fees format.' });
      }
    }

    if (closing_date && next_term_opening_date) {
      if (new Date(next_term_opening_date) <= new Date(closing_date)) {
        return res.status(400).json({ 
          success: false, 
          message: 'Next term opening date must be after the current term closing date.' 
        });
      }
    }

    const query = `
      UPDATE student_term_reports 
      SET 
        closing_date = COALESCE(?, closing_date),
        next_term_opening_date = COALESCE(?, next_term_opening_date),
        fees_balance = COALESCE(?, fees_balance),
        next_term_fees = COALESCE(?, next_term_fees),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;

    const values = [
      closing_date, 
      next_term_opening_date, 
      parsedFeesBalance, 
      parsedNextTermFees, 
      reportId
    ];

    db.run(query, values, function(err) {
      if (err) {
        console.error('Error saving term-end details:', err);
        return res.status(500).json({ 
          success: false, 
          message: 'Internal server error while saving term details.' 
        });
      }

      if (this.changes === 0) {
        return res.status(404).json({ success: false, message: 'Report record not found.' });
      }

      db.get(`SELECT * FROM student_term_reports WHERE id = ?`, [reportId], (fetchErr, updatedRow) => {
        return res.status(200).json({
          success: true,
          message: 'Term dates and fees successfully updated.',
          data: updatedRow || {}
        });
      });
    });

  } catch (error) {
    console.error('Error saving term-end details:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Internal server error while saving term details.' 
    });
  }
});

/* =====================================================
   NCDC TEACHER PLANNER API ROUTES
   Model: gemini-3.8-flash
   Compatible with existing frontend field names
===================================================== */

// Helper: clean and parse Gemini's JSON response
function parsePlannerResponseJson(responseText) {
  let cleaned = responseText
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  // Recover a JSON object if extra text surrounds it
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error("The AI did not return a valid JSON object.");
  }

  cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  return JSON.parse(cleaned);
}
// Retry Gemini requests when the service is temporarily busy
async function generateWithRetry(model, prompt, maxRetries = 3) {
  let attempt = 0;

  while (true) {
    try {
      return await model.generateContent(prompt);

    } catch (error) {
      const status = error.status || error.statusCode ||
                     error.response?.status;

      const message = String(error.message || "").toLowerCase();

      const isDailyQuotaError =
        message.includes("per day") ||
        message.includes("daily limit");

      const isTemporaryError =
        [429, 500, 502, 503, 504].includes(Number(status));

      if (!isTemporaryError || isDailyQuotaError ||
          attempt >= maxRetries) {
        throw error;
      }

      attempt++;

      const delay = Math.pow(2, attempt) * 1000;

      console.log(
        `Gemini temporarily unavailable. Retry ${attempt}/${maxRetries} in ${delay / 1000} seconds.`
      );

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// =====================================================
// 1. GENERATE LESSON PLAN
// =====================================================

app.post("/api/planner/generate-lesson-plan", async (req, res) => {
  try {
    const {
      schoolName,
      teacherName,
      classLevel,
      subject,
      term,
      weekNumber,
      theme,
      topic,
      duration,
      lessonDate,
      startTime,
      endTime
    } = req.body;

    if (!classLevel || !subject || !topic) {
      return res.status(400).json({
        success: false,
        error: "Class level, subject, and topic are required."
      });
    }

    const selectedDuration = duration || "80 minutes";
    const selectedWeek = weekNumber || "Week 1";
    const selectedDate = lessonDate || "Not provided";
    const selectedStartTime = startTime || "Not provided";
    const selectedEndTime = endTime || "Not provided";

    const prompt = `
You are an experienced Ugandan secondary-school teacher, lesson planner,
and curriculum specialist familiar with Uganda's National Curriculum
Development Centre (NCDC) Lower Secondary Competency-Based Curriculum.

Create a detailed, practical, classroom-ready lesson plan using the
information supplied below.

LESSON DETAILS
School: ${schoolName || "Not provided"}
Teacher: ${teacherName || "Not provided"}
Class: ${classLevel}
Subject: ${subject}
Term: ${term || "Term 1"}
Week: ${selectedWeek}
Theme: ${theme || "Not provided"}
Topic: ${topic}
Date: ${selectedDate}
Start Time: ${selectedStartTime}
End Time: ${selectedEndTime}
Lesson duration: ${selectedDuration}

CURRICULUM REQUIREMENTS
1. Align the lesson with the Ugandan curriculum appropriate to the
   selected class and subject.
2. Make the lesson learner-centred, competency-based, inclusive,
   practical, and appropriate to the learners' level.
3. Write observable and achievable learning outcomes.
4. Include relevant generic skills and cross-cutting issues.
5. Provide realistic teaching and learning materials and references.
6. Include assessment activities that measure the stated outcomes.
7. Do not invent official curriculum quotations, textbook page numbers,
   or references that cannot be verified. Use relevant, recognisable
   curriculum documents and textbooks where appropriate.
8. Make all activities specific to the selected subject and topic.
9. The lesson progression MUST contain exactly THREE stages:
   Introduction, Lesson Development, and Lesson Reflection.
10. The progression MUST use exactly these three fields for its columns:
    stage, teacherActivity, learnerActivity.
    The time field is separate and displayed with the stage.
11. Include a time allocation for every stage. The allocations must add
    up to the selected lesson duration. Divide the available time
    sensibly between the three stages.
12. Lesson Reflection is the final lesson stage. Also provide a separate
    teacherReflection field for the teacher to complete after the lesson.
13. Preserve the legacy fields specified in the JSON structure below.

Return ONLY one valid JSON object. Do not use Markdown, code fences,
comments, or text before or after the JSON.

Use this exact JSON structure and field names:

{
  "schoolName": "",
  "teacherName": "",
  "classLevel": "",
  "subject": "",
  "term": "",
  "weekNumber": "",
  "theme": "",
  "topic": "",
  "duration": "",
  "lessonDate": "",
  "startTime": "",
  "endTime": "",
  "competency": "",
  "learningOutcomeFocus": "",
  "learningOutcomes": [
    "Observable learning outcome 1",
    "Observable learning outcome 2",
    "Observable learning outcome 3"
  ],
  "genericSkills": [
    "Relevant generic skill and how it is developed"
  ],
  "crossCuttingIssues": [
    "Relevant cross-cutting issue and how it is addressed"
  ],
  "prerequisiteKnowledge": "",
  "learningMaterials": [
    "Relevant teaching or learning material"
  ],
  "references": [
    "Relevant curriculum document or textbook reference"
  ],
  "progression": [
    {
      "stage": "Introduction",
      "time": "Allocated minutes",
      "teacherActivity": "Specific teacher actions and questions",
      "learnerActivity": "Specific learner actions and responses"
    },
    {
      "stage": "Lesson Development",
      "time": "Allocated minutes",
      "teacherActivity": "Detailed guidance, demonstrations, questioning and facilitation",
      "learnerActivity": "Detailed individual, pair, group or practical activities"
    },
    {
      "stage": "Lesson Reflection",
      "time": "Allocated minutes",
      "teacherActivity": "Guide recap, check understanding and give feedback",
      "learnerActivity": "Summarise learning, respond to questions and reflect"
    }
  ],
  "assessmentCriteria": "",
  "teacherReflection": "",

  "introduction": "",
  "mainActivities": [
    {
      "phase": "Lesson Development",
      "teacherRole": "",
      "learnerRole": ""
    }
  ],
  "conclusion": ""
}

IMPORTANT:
- Fill all lesson details from the supplied information.
- The schoolName, teacherName, classLevel, subject, term, weekNumber,
  theme, topic, duration, lessonDate, startTime, and endTime fields must match the supplied details.
- learningOutcomes must contain measurable outcomes.
- genericSkills and crossCuttingIssues must be relevant to the lesson.
- learningMaterials and references must not be empty unless genuinely
  unavailable.
- progression must have exactly three entries in the specified order.
- Ensure the three time allocations add up to the selected duration.
- teacherActivity and learnerActivity must describe corresponding actions.
- assessmentCriteria must explain how the teacher checks achievement.
- teacherReflection should contain useful prompts or a reflection template.
- For backward compatibility, introduction must summarise the opening
  stage, mainActivities must describe lesson-development activities,
  and conclusion must summarise the closing stage.
`;

    const model = genAI.getGenerativeModel({
      model: "gemini-3.8-flash", // Updated to a standard active model identifier
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.4
      }
    });

    const result = await generateWithRetry(model, prompt);
    const responseText = await result.response.text();
    const parsedData = parsePlannerResponseJson(responseText);

    // Ensure the essential metadata and timing fields are retained
    parsedData.schoolName = schoolName || parsedData.schoolName || "";
    parsedData.teacherName = teacherName || parsedData.teacherName || "";
    parsedData.classLevel = classLevel;
    parsedData.subject = subject;
    parsedData.term = term || "Term 1";
    parsedData.weekNumber = selectedWeek;
    parsedData.theme = theme || "";
    parsedData.topic = topic;
    parsedData.duration = selectedDuration;
    parsedData.lessonDate = selectedDate;
    parsedData.startTime = selectedStartTime;
    parsedData.endTime = selectedEndTime;

    // Validate the new three-stage structure
    if (
      !Array.isArray(parsedData.progression) ||
      parsedData.progression.length !== 3
    ) {
      throw new Error(
        "The AI response did not contain the required three lesson stages."
      );
    }

    res.json({
      success: true,
      data: parsedData
    });

  } catch (error) {
    console.error("Error generating lesson plan:", error);

    res.status(500).json({
      success: false,
      error: "Failed to generate Lesson Plan.",
      details: error.message
    });
  }
});

// =====================================================
// 2. GENERATE SCHEME OF WORK
// =====================================================

app.post("/api/planner/generate-scheme", async (req, res) => {
  try {
    const {
      schoolName,
      teacherName,
      classLevel,
      subject,
      term,
      numWeeks,
      theme,
      topic
    } = req.body;

    if (!classLevel || !subject || !topic) {
      return res.status(400).json({
        success: false,
        error: "Class level, subject, and topic are required."
      });
    }

    const requestedWeeks = Math.max(
      1,
      Math.min(52, Number.parseInt(numWeeks, 10) || 12)
    );

    const prompt = `
You are an experienced Ugandan secondary-school curriculum planner
familiar with the National Curriculum Development Centre (NCDC) and
the Lower Secondary Competency-Based Curriculum.

Prepare a detailed, practical Scheme of Work for the specified subject,
class, term and topic.

SCHEME DETAILS
School: ${schoolName || "Not provided"}
Teacher: ${teacherName || "Not provided"}
Class: ${classLevel}
Subject: ${subject}
Term: ${term || "Term 1"}
Number of weeks: ${requestedWeeks}
Theme: ${theme || "Not provided"}
Topic or unit: ${topic}

REQUIREMENTS
1. Generate exactly ${requestedWeeks} weekly entries.
2. Arrange the weeks in chronological order, starting at Week 1.
3. Sequence sub-topics from introductory concepts to more demanding
   learning, where appropriate.
4. Align specific competencies, content, methods and assessments with
   the selected subject and class.
5. Make activities learner-centred and suitable for the Ugandan school
   context. Include practical work, discussion, group work or projects
   where appropriate to the subject.
6. Include realistic instructional resources, including locally
   available materials where suitable.
7. Every week MUST have its own meaningful remarks.
8. The remarks must be specific to that week's planned learning.
   They may indicate implementation considerations, learner support,
   differentiation, resources to prepare, follow-up, or space for
   recording progress and adjustments.
9. Do not claim that a lesson has been completed. Write remarks as
   useful planning notes or fields for the teacher to complete.
10. Periods must be a positive number appropriate to the content.
11. Avoid repeating identical sub-topics or remarks across all weeks.
12. Do not invent official curriculum quotations, textbook page numbers,
    or unverified references.

Return ONLY a valid JSON object. No Markdown, no code fences, and no
extra text.

Use this exact structure and field names:

{
  "schoolName": "",
  "teacherName": "",
  "classLevel": "",
  "subject": "",
  "term": "",
  "numWeeks": ${requestedWeeks},
  "theme": "",
  "topic": "",
  "generalCompetency": "Overall competency developed across the unit",
  "weeks": [
    {
      "week": "Week 1",
      "subTopic": "Specific sub-topic",
      "periods": 2,
      "specificCompetencies": "Competencies learners should demonstrate",
      "contentSummary": "Key knowledge, concepts and skills",
      "methodsAndActivities": "Teaching methods and learner activities",
      "instructionalResources": "Teaching and learning resources",
      "assessmentMethods": "How the teacher will assess learning",
      "remarks": "Specific planning notes, learner support, follow-up or space for teacher progress notes"
    }
  ]
}

IMPORTANT:
- The weeks array must contain exactly ${requestedWeeks} objects.
- Each object must include all nine fields shown above.
- The remarks field must be completed for EVERY week.
- Use the correct week labels: Week 1, Week 2, Week 3, and so on.
- The school, teacher, class, subject, term, theme and topic must match
  the supplied details.
- The general competency should describe the overall learning expected
  across the unit.
- Keep each field useful, clear and sufficiently detailed for a teacher.
`;

    const model = genAI.getGenerativeModel({
      model: "gemini-3.8-flash",
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.4
      }
    });

    const result = await generateWithRetry(model, prompt);
    const responseText = await result.response.text();
    const parsedData = parsePlannerResponseJson(responseText);

    // Ensure the scheme metadata matches the submitted form
    parsedData.schoolName = schoolName || parsedData.schoolName || "";
    parsedData.teacherName = teacherName || parsedData.teacherName || "";
    parsedData.classLevel = classLevel;
    parsedData.subject = subject;
    parsedData.term = term || "Term 1";
    parsedData.numWeeks = requestedWeeks;
    parsedData.theme = theme || "";
    parsedData.topic = topic;

    if (!Array.isArray(parsedData.weeks)) {
      throw new Error("The AI response did not contain a valid weeks array.");
    }

    // Normalise weekly fields so the frontend has consistent values.
    // Keep every existing field and add remarks where missing.
    parsedData.weeks = parsedData.weeks.map((week, index) => ({
      week: week.week || `Week ${index + 1}`,
      subTopic: week.subTopic || "",
      periods: week.periods || 2,
      specificCompetencies: week.specificCompetencies || "",
      contentSummary: week.contentSummary || "",
      methodsAndActivities: week.methodsAndActivities || "",
      instructionalResources: week.instructionalResources || "",
      assessmentMethods: week.assessmentMethods || "",
      remarks: week.remarks || "Teacher to record progress and any adjustments."
    }));

    // Make sure the requested number of weeks is returned.
    if (parsedData.weeks.length !== requestedWeeks) {
      throw new Error(
        `The AI returned ${parsedData.weeks.length} weeks instead of ${requestedWeeks}. Please generate the scheme again.`
      );
    }

    res.json({
      success: true,
      data: parsedData
    });

  } catch (error) {
    console.error("Error generating scheme of work:", error);

    res.status(500).json({
      success: false,
      error: "Failed to generate Scheme of Work.",
      details: error.message
    });
  }
});


const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

module.exports = app;
