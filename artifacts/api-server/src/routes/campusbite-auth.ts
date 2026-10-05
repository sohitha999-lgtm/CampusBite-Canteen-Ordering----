import { Router, type IRouter } from "express";
import {
  LoginAdminBody,
  LoginAdminResponse,
  LoginCustomerBody,
  LoginCustomerResponse,
  LogoutResponse,
  RegisterCustomerBody,
  RegisterCustomerResponse,
  GetSessionResponse,
} from "@workspace/api-zod";
import {
  authenticate,
  createCustomer,
  createSession,
  finishLogout,
  getSessionUser,
  seedAdminFromEnvironment,
  toSessionResponse,
} from "../lib/campus-auth";

const router: IRouter = Router();
seedAdminFromEnvironment();

router.post("/auth/register", (req, res): void => {
  const parsed = RegisterCustomerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const user = createCustomer(
      parsed.data.name,
      parsed.data.email,
      parsed.data.password,
      parsed.data.phone ?? null,
    );
    createSession(user, res);
    res.status(201).json(RegisterCustomerResponse.parse(toSessionResponse(user)));
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed: users.email")) {
      res.status(409).json({ error: "An account with this email already exists." });
      return;
    }
    throw error;
  }
});

router.post("/auth/login", (req, res): void => {
  const parsed = LoginCustomerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = authenticate(parsed.data.email, parsed.data.password);
  if (!user || user.role !== "CUSTOMER") {
    res.status(401).json({ error: "Email or password is incorrect." });
    return;
  }
  createSession(user, res);
  res.json(LoginCustomerResponse.parse(toSessionResponse(user)));
});

router.post("/auth/admin/login", (req, res): void => {
  const parsed = LoginAdminBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = authenticate(parsed.data.email, parsed.data.password);
  if (!user || user.role !== "ADMIN") {
    res.status(401).json({ error: "Admin email or password is incorrect." });
    return;
  }
  createSession(user, res);
  res.json(LoginAdminResponse.parse(toSessionResponse(user)));
});

router.post("/auth/logout", (req, res): void => {
  finishLogout(req, res);
  res.status(204).end();
});

router.get("/auth/me", (req, res): void => {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: "Please sign in to continue." });
    return;
  }
  res.json(GetSessionResponse.parse(toSessionResponse(user)));
});

export default router;
