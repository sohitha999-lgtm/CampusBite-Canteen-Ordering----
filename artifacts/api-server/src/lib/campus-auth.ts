import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import type { Request, Response } from "express";
import { campusDb } from "./campus-db";

const SESSION_COOKIE = "campusbite_session";
const SESSION_DAYS = 14;
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret) {
  throw new Error("SESSION_SECRET must be set to start CampusBite authentication.");
}

export type CampusRole = "CUSTOMER" | "ADMIN";
export interface CampusUser {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  role: CampusRole;
}

interface UserRow extends CampusUser {
  password_hash: string;
  password_salt: string;
}

function passwordDigest(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString("hex");
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(passwordDigest(password, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hashSessionToken(token: string): string {
  return createHmac("sha256", sessionSecret!).update(token).digest("hex");
}

function cookieToken(request: Request): string | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;
  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return cookie ? cookie.slice(SESSION_COOKIE.length + 1) || null : null;
}

function setSessionCookie(response: Response, token: string): void {
  response.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}

function clearSessionCookie(response: Response): void {
  response.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

function publicUser(user: CampusUser): CampusUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
  };
}

export function seedAdminFromEnvironment(): void {
  const email = process.env.CAMPUSBITE_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.CAMPUSBITE_ADMIN_PASSWORD;
  if (!email || !password) return;

  const salt = randomBytes(16).toString("hex");
  const hash = passwordDigest(password, salt);
  campusDb.prepare(`
    INSERT INTO users (name, email, phone, password_hash, password_salt, role, created_at)
    VALUES ('Canteen Admin', ?, NULL, ?, ?, 'ADMIN', ?)
    ON CONFLICT(email) DO UPDATE SET
      name = 'Canteen Admin',
      password_hash = excluded.password_hash,
      password_salt = excluded.password_salt,
      role = 'ADMIN'
  `).run(email, hash, salt, new Date().toISOString());
}

export function createSession(user: CampusUser, response: Response): CampusUser {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  campusDb.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
  campusDb
    .prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(hashSessionToken(token), user.id, expiresAt);
  setSessionCookie(response, token);
  return publicUser(user);
}

export function getSessionUser(request: Request): CampusUser | null {
  const token = cookieToken(request);
  if (!token) return null;
  const row = campusDb.prepare(`
    SELECT users.id, users.name, users.email, users.phone, users.role
    FROM sessions
    JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hashSessionToken(token), new Date().toISOString()) as CampusUser | undefined;
  return row ? publicUser(row) : null;
}

export function requireCampusUser(
  request: Request,
  response: Response,
  role?: CampusRole,
): CampusUser | null {
  const user = getSessionUser(request);
  if (!user) {
    response.status(401).json({ error: "Please sign in to continue." });
    return null;
  }
  if (role && user.role !== role) {
    response.status(403).json({ error: "You do not have access to this area." });
    return null;
  }
  return user;
}

export function authenticate(
  email: string,
  password: string,
): UserRow | undefined {
  const user = campusDb
    .prepare("SELECT id, name, email, phone, role, password_hash, password_salt FROM users WHERE email = ?")
    .get(email.trim().toLowerCase()) as UserRow | undefined;
  if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) return undefined;
  return user;
}

export function finishLogout(request: Request, response: Response): void {
  const token = cookieToken(request);
  if (token) {
    campusDb.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashSessionToken(token));
  }
  clearSessionCookie(response);
}

export function createCustomer(
  name: string,
  email: string,
  password: string,
  phone: string | null,
): CampusUser {
  const salt = randomBytes(16).toString("hex");
  const hash = passwordDigest(password, salt);
  const result = campusDb.prepare(`
    INSERT INTO users (name, email, phone, password_hash, password_salt, role, created_at)
    VALUES (?, ?, ?, ?, ?, 'CUSTOMER', ?)
  `).run(name.trim(), email.trim().toLowerCase(), phone, hash, salt, new Date().toISOString());

  return {
    id: Number(result.lastInsertRowid),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    phone,
    role: "CUSTOMER",
  };
}

export function toSessionResponse(user: CampusUser) {
  return { user: publicUser(user) };
}
