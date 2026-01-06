import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

const JUDGE_SYSTEM_PROMPT = `You decide if the AI should interrupt the user. Output ONLY: {"interrupt":true} or {"interrupt":false}

INTERRUPT when:
- 4+ filler words (um, uh, like, you know)
- User is confused, lost, or rambling
- 25+ words without clear point
- User says "lost", "anxious", "confused"

DO NOT interrupt if user is speaking clearly or asking a question.

JSON only. No explanation.`;

export async function POST(request: NextRequest) {
  const groqApiKey = process.env.GROQ_API_KEY;

  if (!groqApiKey) {
    return NextResponse.json({ interrupt: false }, { status: 200 });
  }

  try {
    const { speech, conversationHistory = [], speakingTime = 0 } = await request.json();

    if (!speech) {
      return NextResponse.json({ interrupt: false });
    }

    const wordCount = speech.split(/\s+/).filter(Boolean).length;
    const fillers = (speech.toLowerCase().match(/\b(um|uh|like|you know)\b/gi) || []).length;

    const historyText = conversationHistory
      .slice(-4)
      .map((m: { role: string; content: string }) => `${m.role}: ${m.content}`)
      .join("\n");

    const groq = new Groq({ apiKey: groqApiKey });

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: JUDGE_SYSTEM_PROMPT },
        { role: "user", content: `${historyText ? historyText + "\n\n" : ""}USER NOW: "${speech}" [${wordCount} words, ${fillers} fillers, ${speakingTime.toFixed(1)}s]` }
      ],
      max_tokens: 20,
      temperature: 0,
    });

    const content = response.choices[0]?.message?.content?.trim() || "";
    const interrupt = content.includes('"interrupt":true') || content.includes('"interrupt": true');
    
    console.log(`🤖 LLM Judge: ${interrupt ? "INTERRUPT" : "continue"}`);

    return NextResponse.json({ interrupt });
  } catch (error) {
    console.error("Judge error:", error);
    return NextResponse.json({ interrupt: false });
  }
}

