import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db";
import Message from "@/models/Message";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

async function generateReportContent(stressHistory: string[], sleepHistory: string, riskScore: number): Promise<string> {
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

function generateFallbackReport(stressHistory: string[], sleepHistory: string, riskScore: number): string {
  const highCount = stressHistory.filter(s => s.includes("HIGH")).length;
  const medCount = stressHistory.filter(s => s.includes("MEDIUM")).length;
  const lowCount = stressHistory.filter(s => s.includes("LOW")).length;
  const total = stressHistory.length;

  return `USER SUMMARY
Based on ${total} recent interactions, the user shows ${highCount > medCount ? "elevated" : "moderate"} stress levels. Sleep quality is reported as ${sleepHistory}. Current burnout risk score is ${riskScore}/100.

STRESS PATTERN ANALYSIS
Out of ${total} recorded sessions:
- High Stress: ${highCount} sessions (${total > 0 ? Math.round((highCount/total)*100) : 0}%)
- Medium Stress: ${medCount} sessions (${total > 0 ? Math.round((medCount/total)*100) : 0}%)
- Low Stress: ${lowCount} sessions (${total > 0 ? Math.round((lowCount/total)*100) : 0}%)
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { email?: string; riskScore?: number; sleepQuality?: string };
    const email = body.email;
    const riskScore = body.riskScore ?? 0;
    const sleepQuality = body.sleepQuality ?? "GOOD";

    // Fetch recent messages
    let stressHistory: string[] = [];
    try {
      await connectToDatabase();
      const recentMessages = await Message.find({})
        .sort({ createdAt: -1 })
        .limit(10)
        .lean<Array<{ text: string; stress: string; sleep?: string; createdAt: Date }>>();

      if (recentMessages.length === 0) {
        return NextResponse.json({ error: "Not enough data to generate report. Please chat a bit first." }, { status: 400 });
      }

      stressHistory = recentMessages.map(m =>
        `[${new Date(m.createdAt).toLocaleDateString()}] Stress: ${m.stress} | "${m.text.slice(0, 60)}"`
      );
    } catch (dbError) {
      console.error("[generate-report] DB error", dbError);
      stressHistory = ["No historical data available (database unavailable)"];
    }

    // Generate report content via AI
    const reportContent = await generateReportContent(stressHistory, sleepQuality, riskScore);

    // Generate PDF with pdf-lib
    const pdfDoc = await PDFDocument.create();
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const orange = rgb(1, 0.55, 0.26);      // #FF8C42
    const darkText = rgb(0.1, 0.1, 0.1);
    const grayText = rgb(0.4, 0.4, 0.4);
    const white = rgb(1, 1, 1);
    const pageWidth = 595;
    const margin = 50;
    const contentWidth = pageWidth - margin * 2;

    let page = pdfDoc.addPage([595, 842]); // A4
    let y = 842;

    // --- Header Bar ---
    page.drawRectangle({ x: 0, y: y - 80, width: pageWidth, height: 80, color: orange });
    page.drawText("Care Companion", { x: margin, y: y - 45, size: 24, font: helveticaBold, color: white });
    page.drawText(`Report: ${new Date().toLocaleDateString("en-IN", { dateStyle: "full" })}`, { x: margin, y: y - 65, size: 10, font: helvetica, color: rgb(1, 1, 1) });

    // Risk badge
    const badgeColor = riskScore > 60 ? rgb(0.86, 0.15, 0.15) : riskScore > 30 ? rgb(0.85, 0.47, 0.02) : rgb(0.02, 0.59, 0.41);
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

      // Check if we need a new page
      if (y < 80) {
        page = pdfDoc.addPage([595, 842]);
        y = 800;
      }

      // Section headers (ALL CAPS lines with 3+ chars, not starting with - or number)
      if (trimmed === trimmed.toUpperCase() && trimmed.length > 3 && !/^[\d\-\[\(]/.test(trimmed)) {
        y -= 8;
        page.drawRectangle({ x: margin, y: y - 2, width: contentWidth, height: 1, color: orange });
        y -= 6;
        page.drawText(trimmed, { x: margin, y: y - 14, size: 13, font: helveticaBold, color: orange });
        y -= 26;
      }
      // Numbered or bullet items
      else if (/^\d+\./.test(trimmed) || trimmed.startsWith("-")) {
        // Word-wrap long lines
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

    // --- Footer ---
    if (y < 100) { page = pdfDoc.addPage([595, 842]); y = 800; }
    y -= 20;
    page.drawRectangle({ x: margin, y: y, width: contentWidth, height: 0.5, color: rgb(0.9, 0.9, 0.9) });
    y -= 16;
    page.drawText("This report is generated by Care Companion for informational purposes only. Not a medical diagnosis.", {
      x: margin, y: y, size: 8, font: helvetica, color: grayText
    });
    if (email) {
      y -= 14;
      page.drawText(`User: ${email}`, { x: margin, y: y, size: 8, font: helvetica, color: grayText });
    }

    const pdfBytes = await pdfDoc.save();

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="care-companion-report-${Date.now()}.pdf"`,
        "Content-Length": pdfBytes.length.toString(),
      },
    });
  } catch (error) {
    console.error("[generate-report] Unhandled error", error);
    return NextResponse.json({ error: "Failed to generate report." }, { status: 500 });
  }
}

// Helper: word-wrap text to fit within a given pixel width
function wrapText(text: string, font: any, fontSize: number, maxWidth: number): string[] {
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
