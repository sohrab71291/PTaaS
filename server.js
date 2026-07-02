

const express = require("express");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(express.json());

const PORT = process.env.DUMMY_PORT || 3002;

const users = [
  {
    username: "admin",
    password: "Admin@123"
  }
];

const sessions = new Set();
const customers = [];

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      error: "Missing or invalid session token"
    });
  }

  const token = authHeader.split(" ")[1];

  if (!sessions.has(token)) {
    return res.status(401).json({
      error: "Unauthorized session token"
    });
  }

  next();
}

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({
      error: "Username and password are required"
    });
  }

  const user = users.find(
    u => u.username === username && u.password === password
  );

  if (!user) {
    return res.status(401).json({
      error: "Invalid username or password"
    });
  }

  const sessionToken = uuidv4().replace(/-/g, "");
  sessions.add(sessionToken);

  return res.status(200).json({
    message: "Login successful",
    sessionToken
  });
});

app.post("/api/customers", authMiddleware, (req, res) => {
  const { name, email, phone, city } = req.body;

  if (!name || !email || !phone || !city) {
    return res.status(400).json({
      error: "name, email, phone and city are required"
    });
  }

  const customer = {
    id: `cus_${uuidv4()}`,
    name,
    email,
    phone,
    city,
    createdAt: new Date().toISOString()
  };

  customers.push(customer);

  return res.status(201).json({
    message: "Customer created successfully",
    data: customer
  });
});

app.get("/api/customers", authMiddleware, (req, res) => {
  return res.status(200).json({
    data: customers
  });
});

app.get("/api/customers/:id", authMiddleware, (req, res) => {
  const customer = customers.find(c => c.id === req.params.id);

  if (!customer) {
    return res.status(404).json({
      error: "Customer not found"
    });
  }

  return res.status(200).json({
    data: customer
  });
});

app.put("/api/customers/:id", authMiddleware, (req, res) => {
  const customer = customers.find(c => c.id === req.params.id);

  if (!customer) {
    return res.status(404).json({
      error: "Customer not found"
    });
  }

  Object.assign(customer, req.body);

  return res.status(200).json({
    message: "Customer updated successfully",
    data: customer
  });
});

app.delete("/api/customers/:id", authMiddleware, (req, res) => {
  const index = customers.findIndex(c => c.id === req.params.id);

  if (index === -1) {
    return res.status(404).json({
      error: "Customer not found"
    });
  }

  customers.splice(index, 1);

  return res.status(200).json({
    message: "Customer deleted successfully"
  });
});

app.listen(PORT, () => {
  console.log(`Dummy API running on http://localhost:${PORT}`);
});