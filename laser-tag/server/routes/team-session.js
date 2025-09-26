const express = require("express");
const appData = require("../app-data");

const router = express.Router();

try{
// new team session ID
router.get("/new-id", (req, res) => {
  const newSessionId = appData.getUniqueSessionId();
  console.log("Generated new session ID:", newId);
  res.status(200).json({ id: newSessionId });
  
});
} catch (error) {
  console.error('Error generating session ID:', error);
    res.status(500).json({ error: 'Failed to generate session ID' });
}


module.exports = router;
