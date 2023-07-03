const express = require("express");
const { createConnection, createPool } = require("mysql2/promise");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const router = express.Router();
const nodemailer = require("nodemailer");
const dotenv = require("dotenv").config();

// Generate a random confirmation code
function generateConfirmationCode() {
  const characters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return code;
}

// Send confirmation code to the user's email
function sendConfirmationCode(email, code) {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.email",
    service: "gmail", // e.g., Gmail, Outlook
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: "Email Confirmation Code",
    text: `Your confirmation code is: ${code}`,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Error sending email:", error);
    } else {
      console.log("Email sent:", info.response);
    }
  });
}

//Register api
router.route("/register").post(async (req, res) => {
  const { firstName, lastName, email, password, role } = req.body;

  try {
    const connection = await createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });

    // Check if the table exists, and if not, create it
    await connection.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      first_name VARCHAR(255) NOT NULL,
      last_name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      username VARCHAR(255) NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(255) NOT NULL,
      confirmation_code VARCHAR(255) NOT NULL,
      is_confirmed BOOLEAN DEFAULT false
    )
  `);
    // Check if the email is already registered
    const [emailRows] = await connection.execute(
      "SELECT * FROM users WHERE email = ?",
      [email]
    );

    // Generate the username from the first 2 letters of the first name and last 2 letters of the last name
    const username =
      firstName.substring(0, 2) + lastName.substring(lastName.length - 2);

    if (emailRows.length > 0) {
      res.status(400).json({ message: "Email already registered" });
      return;
    }

    // Hash the password using bcrypt
    const hashedPassword = await bcrypt.hash(password, 10);

    // Generate a confirmation code
    const confirmationCode = generateConfirmationCode();

    // Insert the new user into the database
    const [insertResult] = await connection.execute(
      "INSERT INTO users (first_name, last_name, email, username, password, role, confirmation_code) VALUES (?, ?, ?, ?, ?, ?,?)",
      [
        firstName,
        lastName,
        email,
        username,
        hashedPassword,
        role,
        confirmationCode,
      ]
    );

    const userId = insertResult.insertId;

    // Generate a token for the new user
    const token = jwt.sign({ userId, role }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    // Send confirmation code to user's email
    sendConfirmationCode(email, confirmationCode);

    res.status(201).json({ message: "User registered successfully", token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});
//confirm Api
router.route("/confirm", async (req, res) => {
  const [email, confirmation_code] = req.body;
  try {
    const connection = await createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });

    // Check if the confirmation code is valid and matches the one stored in the database
    const [userRows] = await connection.execute(
      "SELECT * FROM users WHERE email = ? AND confirmation_code = ?",
      [email, confirmation_code]
    );

    if (userRows.length === 0) {
      res.status(400).json({ message: "Invalid confirmation code" });
      return;
    }

    // Update the user's confirmation status
    await connection.execute(
      "UPDATE users SET is_confirmed = true WHERE email = ?",
      [email]
    );
    res.status(200).json({ message: "Confirmation successful" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

//Login api
router.route("/login").post(async (req, res) => {
  const { identifier, password } = req.body;
  try {
    const connection = await createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });

    // Retrieve the user with the provided email or username
    const [userRows] = await connection.execute(
      "SELECT * FROM users WHERE email = ? OR username = ?",
      [identifier, identifier]
    );

    if (userRows.length === 0) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    const user = userRows[0];

    // Compare the provided password with the hashed password stored in the database
    const passwordMatch = await bcrypt.compare(password, user.password);

    if (!passwordMatch) {
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }

    // Generate a token for the authenticated user
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );
    res.status(200).json({ message: "Login successful" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error" });
  }
});

const pool = createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

router.route("/projects/apply").post(async (req, res) => {
  const username = req.body.username;
  const projectName = req.body.projectName;

  try {
    // Retrieve the user ID based on the username
    const getUserIdQuery = "SELECT id FROM users WHERE username = ?";
    const [userResults] = await pool.query(getUserIdQuery, [username]);

    if (userResults.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const userId = userResults[0].id;

    // Retrieve the project ID based on the project name
    const getProjectIdQuery = "SELECT id FROM current_projects WHERE name = ?";
    const [projectResults] = await pool.query(getProjectIdQuery, [projectName]);

    if (projectResults.length === 0) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    const current_project_id = projectResults[0].id;

    // Insert a new row in the user_projects table
    const insertQuery =
      "INSERT INTO user_current_projects (user_id, current_project_id) VALUES (?, ?)";
    const [insertResults] = await pool.query(insertQuery, [
      userId,
      current_project_id,
    ]);

    res.status(200).json({ message: "User applied to project successfully" });
  } catch (error) {
    console.error("Error applying user to project:", error);
    res.status(500).json({ error: "Failed to apply user to project" });
  }
});

// Apply user to a project
/*router.route("/projects/apply").post((req, res) => {
  ///projects/:projectId/apply
  // const current_project_id = req.params.projectId;
  const username = req.body.username;
  const projectName = req.body.projectName;

  //To test API in postman, i used a varaible to get the project, depending on the project names in the database

  // Retrieve the user ID based on the username
  const getUserIdQuery = "SELECT id FROM users WHERE username = ?";
  pool.query(getUserIdQuery, [username], (error, userResults) => {
    if (error) {
      console.error("Error retrieving user ID:", error);
      res.status(500).json({ error: "Failed to retrieve user ID" });
      return;
    }

    if (userResults.length === 0) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const userId = userResults[0].id;

    // Retrieve the project ID based on the project name
    const getProjectIdQuery = "SELECT id FROM projects WHERE name = ?";
    pool.query(getProjectIdQuery, [projectName], (error, projectResults) => {
      if (error) {
        console.error("Error retrieving project ID:", error);
        res.status(500).json({ error: "Failed to retrieve project ID" });
        return;
      }

      if (projectResults.length === 0) {
        res.status(404).json({ error: "Project not found" });
        return;
      }

      const current_project_id = projectResults[0].id;

      // Insert a new row in the user_projects table
      const insertQuery =
        "INSERT INTO  user_current_projects (user_id, current_project_id) VALUES (?, ?)";
      pool.query(
        insertQuery,
        [userId, current_project_id],
        (error, insertResults) => {
          if (error) {
            console.error("Error applying user to project:", error);
            res.status(500).json({ error: "Failed to apply user to project" });
          } else {
            res
              .status(200)
              .json({ message: "User applied to project successfully" });
          }
        }
      );
    });
  });
});*/

module.exports = router;
