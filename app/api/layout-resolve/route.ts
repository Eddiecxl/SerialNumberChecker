import { NextRequest, NextResponse } from "next/server";

const DEFAULT_MODEL = "openai/gpt-oss-20b";

type SanitizedProfile = {
  sheets?: Array<{
    name?: unknown;
    rowCount?: unknown;
    columnCount?: unknown;
    candidateHeaderRows?: unknown;
  }>;
};

function validProfile(value: unknown): value is SanitizedProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as SanitizedProfile;
  return Array.isArray(profile.sheets)
    && profile.sheets.length > 0
    && profile.sheets.every((sheet) => (
      typeof sheet.name === "string"
      && Number.isInteger(sheet.rowCount)
      && Number.isInteger(sheet.columnCount)
      && Array.isArray(sheet.candidateHeaderRows)
    ));
}

export async function POST(request: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      error: "AI layout assistance is not configured. Confirm the detected columns manually.",
      code: "GROQ_NOT_CONFIGURED",
    }, { status: 503 });
  }

  let body: { profile?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON request." }, { status: 400 });
  }
  if (!validProfile(body.profile)) {
    return NextResponse.json({ error: "A sanitized workbook profile is required." }, { status: 400 });
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.GROQ_LAYOUT_MODEL || DEFAULT_MODEL,
      temperature: 0,
      messages: [{
        role: "system",
        content: "Map workbook device columns only. Never infer hardware. Return JSON with a mappings array containing sheetName, headerRowIndex, serialColumnIndex, role, and optional modelColumnIndex, productNumberColumnIndex, deviceTypeColumnIndex, assetColumnIndex, usernameColumnIndex, departmentColumnIndex.",
      }, {
        role: "user",
        content: JSON.stringify(body.profile),
      }],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    return NextResponse.json({
      error: "AI layout assistance is temporarily unavailable. Confirm the columns manually.",
      code: "GROQ_UPSTREAM_ERROR",
    }, { status: 502 });
  }

  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  try {
    const parsed = JSON.parse(payload.choices?.[0]?.message?.content ?? "");
    if (!Array.isArray(parsed.mappings)) throw new Error("Missing mappings");
    return NextResponse.json({ mappings: parsed.mappings, requiresConfirmation: true });
  } catch {
    return NextResponse.json({
      error: "AI returned an invalid mapping. Confirm the columns manually.",
      code: "GROQ_INVALID_RESPONSE",
    }, { status: 502 });
  }
}
