import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import Message from "@/models/Message";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import nodemailer from "nodemailer";

// ─── Types ───────────────────────────────────────────────────────────────────

interface LocationData {
  lat: number;
  lng: number;
}

interface SendReportBody {
  userId?: string;
  doctorEmail?: string;
  riskScore?: number;
  sleepQuality?: string;
  location?: LocationData;
  shareLocation?: boolean;
}

// ─── AI Report Generation ────────────────────────────────────────────────────

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

async function generateReportContent(
  stressHistory: string[],
  sleepHistory: string,
  riskScore: number
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

  const prompt = `You are generating a professional stress analysis report for a caregiver.

Input:
Stress History (recent messages with stress levels): ${stressHistory.join(" | ")}
Sleep Quality: ${sleepHistory}
Risk Score: ${riskScore}/100

Generate a structured report with these sections. Use plain text, no markdown:

1. USER SUMMARY - Brief overview of the user's recent emotional state
2. STRESS PATTERN ANALYSIS - Identify trends in the stress data
3. SLEEP IMPACT - How sleep quality affects their wellbeing
4. RISK ASSESSMENT - Current burnout risk level and what it means
5. KEY OBSERVATIONS - 3-4 specific findings from the data
6. RECOMMENDATIONS - 4-5 actionable, specific suggestions
7. CONCLUSION - Encouraging closing statement

Keep it professional, empathetic, and actionable. No generic advice.`;

  if (!apiKey) {
    return generateFallbackReport(stressHistory, sleepHistory, riskScore);
  }

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 1200,
      }),
    });

    if (!response.ok) {
      return generateFallbackReport(stressHistory, sleepHistory, riskScore);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    return content || generateFallbackReport(stressHistory, sleepHistory, riskScore);
  } catch {
    return generateFallbackReport(stressHistory, sleepHistory, riskScore);
  }
}

function generateFallbackReport(
  stressHistory: string[],
  sleepHistory: string,
  riskScore: number
): string {
  const highCount = stressHistory.filter((s) => s.includes("HIGH")).length;
  const medCount = stressHistory.filter((s) => s.includes("MEDIUM")).length;
  const lowCount = stressHistory.filter((s) => s.includes("LOW")).length;
  const total = stressHistory.length;

  return `USER SUMMARY
Based on ${total} recent interactions, the user shows ${highCount > medCount ? "elevated" : "moderate"} stress levels. Sleep quality is reported as ${sleepHistory}. Current burnout risk score is ${riskScore}/100.

STRESS PATTERN ANALYSIS
Out of ${total} recorded sessions:
- High Stress: ${highCount} sessions (${total > 0 ? Math.round((highCount / total) * 100) : 0}%)
- Medium Stress: ${medCount} sessions (${total > 0 ? Math.round((medCount / total) * 100) : 0}%)
- Low Stress: ${lowCount} sessions (${total > 0 ? Math.round((lowCount / total) * 100) : 0}%)
${highCount >= 3 ? "A concerning pattern of consecutive high-stress sessions has been detected." : "Stress levels appear manageable but should be monitored."}

SLEEP IMPACT
Current sleep quality: ${sleepHistory}
${sleepHistory === "POOR" ? "Poor sleep quality is a significant contributor to burnout risk and may be amplifying stress responses." : "Good sleep quality is a protective factor and helps maintain resilience."}

RISK ASSESSMENT
Current Risk Score: ${riskScore}/100
Risk Level: ${riskScore > 60 ? "HIGH - Immediate attention recommended" : riskScore > 30 ? "MODERATE - Preventive measures advised" : "LOW - Continue maintaining healthy habits"}

KEY OBSERVATIONS
1. ${highCount >= 2 ? "Multiple high-stress episodes detected in recent history" : "Stress levels have been relatively stable"}
2. Sleep quality is ${sleepHistory === "POOR" ? "negatively impacting" : "positively supporting"} overall wellbeing
3. ${riskScore > 60 ? "Burnout risk has crossed the critical threshold" : "Burnout risk remains within manageable range"}
4. Continued monitoring is recommended for early intervention

RECOMMENDATIONS
1. Schedule 15-minute breaks between caregiving tasks
2. ${sleepHistory === "POOR" ? "Prioritize sleep hygiene - establish a consistent bedtime routine" : "Maintain current sleep schedule"}
3. Identify one task per day that can be delegated to reduce workload
4. Practice 5-minute breathing exercises during peak stress moments
5. Connect with a support group or trusted friend weekly

CONCLUSION
Caregiving is deeply meaningful work, and taking care of yourself is essential to sustaining it. Your wellbeing matters. Small, consistent changes can significantly reduce burnout risk over time.`;
}

// ─── PDF Generation (buffer-based, with optional location) ───────────────────

function wrapText(
  text: string,
  font: any,
  fontSize: number,
  maxWidth: number
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(test, fontSize);
    if (width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function generatePdfBuffer(
  reportContent: string,
  riskScore: number,
  userEmail?: string,
  location?: LocationData
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const orange = rgb(1, 0.55, 0.26);
  const darkText = rgb(0.1, 0.1, 0.1);
  const grayText = rgb(0.4, 0.4, 0.4);
  const white = rgb(1, 1, 1);
  const blueLink = rgb(0.05, 0.35, 0.75);
  const pageWidth = 595;
  const margin = 50;
  const contentWidth = pageWidth - margin * 2;

  let page = pdfDoc.addPage([595, 842]); // A4
  let y = 842;

  // --- Header Bar ---
  page.drawRectangle({ x: 0, y: y - 80, width: pageWidth, height: 80, color: orange });
  page.drawText("Care Companion", { x: margin, y: y - 45, size: 24, font: helveticaBold, color: white });
  page.drawText(
    `Report: ${new Date().toLocaleDateString("en-IN", { dateStyle: "full" })}`,
    { x: margin, y: y - 65, size: 10, font: helvetica, color: white }
  );

  // Risk badge
  const badgeColor =
    riskScore > 60 ? rgb(0.86, 0.15, 0.15) : riskScore > 30 ? rgb(0.85, 0.47, 0.02) : rgb(0.02, 0.59, 0.41);
  page.drawRectangle({ x: 430, y: y - 65, width: 115, height: 40, color: badgeColor, borderColor: white, borderWidth: 1 });
  page.drawText("RISK SCORE", { x: 450, y: y - 40, size: 8, font: helvetica, color: white });
  page.drawText(`${riskScore} / 100`, { x: 452, y: y - 56, size: 16, font: helveticaBold, color: white });

  y -= 110;

  // --- Render report content ---
  const lines = reportContent.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      y -= 10;
      continue;
    }

    if (y < 80) {
      page = pdfDoc.addPage([595, 842]);
      y = 800;
    }

    // Section headers (ALL CAPS lines with 3+ chars)
    if (trimmed === trimmed.toUpperCase() && trimmed.length > 3 && !/^[\d\-\[\(]/.test(trimmed)) {
      y -= 8;
      page.drawRectangle({ x: margin, y: y - 2, width: contentWidth, height: 1, color: orange });
      y -= 6;
      page.drawText(trimmed, { x: margin, y: y - 14, size: 13, font: helveticaBold, color: orange });
      y -= 26;
    }
    // Numbered or bullet items
    else if (/^\d+\./.test(trimmed) || trimmed.startsWith("-")) {
      const wrappedLines = wrapText(trimmed, helvetica, 10, contentWidth - 15);
      for (const wl of wrappedLines) {
        if (y < 80) { page = pdfDoc.addPage([595, 842]); y = 800; }
        page.drawText(wl, { x: margin + 15, y: y - 12, size: 10, font: helvetica, color: darkText });
        y -= 16;
      }
    }
    // Regular text
    else {
      const wrappedLines = wrapText(trimmed, helvetica, 10, contentWidth);
      for (const wl of wrappedLines) {
        if (y < 80) { page = pdfDoc.addPage([595, 842]); y = 800; }
        page.drawText(wl, { x: margin, y: y - 12, size: 10, font: helvetica, color: darkText });
        y -= 16;
      }
    }
  }

  // --- Location Section (if provided) ---
  if (location) {
    if (y < 160) { page = pdfDoc.addPage([595, 842]); y = 800; }
    y -= 16;
    page.drawRectangle({ x: margin, y: y - 2, width: contentWidth, height: 1, color: orange });
    y -= 6;
    page.drawText("USER LOCATION", { x: margin, y: y - 14, size: 13, font: helveticaBold, color: orange });
    y -= 30;

    page.drawText(`Latitude: ${location.lat.toFixed(6)}`, { x: margin, y: y - 12, size: 10, font: helvetica, color: darkText });
    y -= 16;
    page.drawText(`Longitude: ${location.lng.toFixed(6)}`, { x: margin, y: y - 12, size: 10, font: helvetica, color: darkText });
    y -= 20;

    const mapsUrl = `https://www.google.com/maps?q=${location.lat},${location.lng}`;
    page.drawText("Google Maps:", { x: margin, y: y - 12, size: 10, font: helveticaBold, color: darkText });
    y -= 16;
    page.drawText(mapsUrl, { x: margin, y: y - 12, size: 9, font: helvetica, color: blueLink });
    y -= 20;
  }

  // --- Footer ---
  if (y < 100) { page = pdfDoc.addPage([595, 842]); y = 800; }
  y -= 20;
  page.drawRectangle({ x: margin, y: y, width: contentWidth, height: 0.5, color: rgb(0.9, 0.9, 0.9) });
  y -= 16;
  page.drawText(
    "This report is generated by Care Companion for informational purposes only. Not a medical diagnosis.",
    { x: margin, y: y, size: 8, font: helvetica, color: grayText }
  );
  if (userEmail) {
    y -= 14;
    page.drawText(`User: ${userEmail}`, { x: margin, y: y, size: 8, font: helvetica, color: grayText });
  }

  return await pdfDoc.save();
}

// ─── Email Sending (with optional location) ──────────────────────────────────

async function sendEmailWithPdf(
  doctorEmail: string,
  pdfBuffer: Uint8Array,
  riskScore: number,
  userEmail?: string,
  location?: LocationData
): Promise<void> {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  // Build location section for email body
  let locationSection = "";
  if (location) {
    const mapsUrl = `https://www.google.com/maps?q=${location.lat},${location.lng}`;
    locationSection = `
--- USER LOCATION (shared with consent) ---
Latitude: ${location.lat.toFixed(6)}
Longitude: ${location.lng.toFixed(6)}
Google Maps: ${mapsUrl}
`;
  }

  await transporter.sendMail({
    from: `"Care Companion" <${process.env.EMAIL_USER}>`,
    to: doctorEmail,
    subject: `⚠️ High Stress Alert — Immediate Attention Required (Risk: ${riskScore}/100)`,
    text: `Dear Doctor,

⚠️ HIGH STRESS ALERT — Risk Score: ${riskScore}/100

This is an automated alert from Care Companion. The patient${userEmail ? ` (${userEmail})` : ""} has crossed the critical burnout risk threshold.

Please find attached a detailed stress analysis report with:
- Recent stress patterns
- Sleep quality impact
- Risk assessment
- Personalized recommendations
${locationSection}
Please review the attached report and take appropriate action at your earliest convenience.

Best regards,
Care Companion System`,
    html: `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <div style="background: linear-gradient(135deg, #FF8C42, #FF4D4D); padding: 24px 32px; border-radius: 12px 12px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 20px;">⚠️ High Stress Alert</h1>
    <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">Care Companion — Automated Alert System</p>
  </div>
  <div style="background: #fff; padding: 32px; border: 1px solid #e5e5e5; border-top: none;">
    <div style="background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
      <p style="margin: 0; color: #DC2626; font-weight: bold; font-size: 18px;">Risk Score: ${riskScore}/100</p>
      <p style="margin: 4px 0 0; color: #991B1B; font-size: 13px;">Patient has crossed the critical burnout threshold</p>
    </div>
    <p style="color: #374151; line-height: 1.6;">Dear Doctor,</p>
    <p style="color: #374151; line-height: 1.6;">The patient${userEmail ? ` <strong>${userEmail}</strong>` : ""} has triggered an automatic stress alert. A detailed PDF report is attached with stress patterns, sleep impact, and recommendations.</p>
    ${location ? `
    <div style="background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 8px; padding: 16px; margin: 20px 0;">
      <p style="margin: 0 0 8px; color: #1E40AF; font-weight: bold; font-size: 14px;">📍 Patient Location (shared with consent)</p>
      <p style="margin: 0; color: #1E3A5F; font-size: 13px;">Latitude: ${location.lat.toFixed(6)} | Longitude: ${location.lng.toFixed(6)}</p>
      <a href="https://www.google.com/maps?q=${location.lat},${location.lng}" style="display: inline-block; margin-top: 12px; background: #2563EB; color: white; padding: 8px 20px; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: bold;">📍 Open in Google Maps</a>
    </div>` : ""}
    <p style="color: #6B7280; font-size: 12px; margin-top: 24px; border-top: 1px solid #E5E7EB; padding-top: 16px;">This is an automated message from Care Companion. Please review the attached report for full details.</p>
  </div>
</div>`,
    attachments: [
      {
        filename: `stress-report-${Date.now()}.pdf`,
        content: Buffer.from(pdfBuffer),
        contentType: "application/pdf",
      },
    ],
  });
}

// ─── API Route Handler ───────────────────────────────────────────────────────

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SendReportBody;
    const { userId, doctorEmail, riskScore = 0, sleepQuality = "GOOD", location, shareLocation } = body;

    // --- Validate inputs ---
    if (!doctorEmail || !doctorEmail.includes("@")) {
      return NextResponse.json(
        { error: "A valid doctor email address is required." },
        { status: 400 }
      );
    }

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      return NextResponse.json(
        { error: "Email service is not configured on the server." },
        { status: 500 }
      );
    }

    // --- Safety: only use location if shareLocation is explicitly true ---
    const safeLocation = (shareLocation === true && location?.lat && location?.lng) ? location : undefined;

    // --- Fetch recent messages from MongoDB ---
    let stressHistory: string[] = [];
    try {
      await connectToDatabase();
      const recentMessages = await Message.find({})
        .sort({ createdAt: -1 })
        .limit(10)
        .lean<Array<{ text: string; stress: string; sleep?: string; createdAt: Date }>>();

      if (recentMessages.length === 0) {
        return NextResponse.json(
          { error: "Not enough data to generate report. Please chat a bit first." },
          { status: 400 }
        );
      }

      stressHistory = recentMessages.map(
        (m) =>
          `[${new Date(m.createdAt).toLocaleDateString()}] Stress: ${m.stress} | "${m.text.slice(0, 60)}"`
      );
    } catch (dbError) {
      console.error("[send-report] DB error", dbError);
      return NextResponse.json(
        { error: "Failed to connect to the database." },
        { status: 500 }
      );
    }

    // --- Generate AI report ---
    const reportContent = await generateReportContent(stressHistory, sleepQuality, riskScore);

    // --- Generate PDF buffer (with location if consented) ---
    const pdfBuffer = await generatePdfBuffer(reportContent, riskScore, userId, safeLocation);

    // --- Send email (with location if consented) ---
    try {
      await sendEmailWithPdf(doctorEmail, pdfBuffer, riskScore, userId, safeLocation);
    } catch (emailError) {
      console.error("[send-report] Email error", emailError);
      return NextResponse.json(
        { error: "Report generated but email failed to send. Please check the doctor's email address." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[send-report] Unhandled error", error);
    return NextResponse.json(
      { error: "Failed to generate and send report." },
      { status: 500 }
    );
  }
}
