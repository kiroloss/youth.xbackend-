const express = require("express");
const dotenv = require("dotenv").config();

const app = express();

app.use(express.json());
const port = process.env.PORT || 2001;

app.use("/api", require("./routes/Routes"));
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
