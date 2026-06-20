import { t } from "./translations.js";
import { showToast, formatError } from "./utils.js";
import { parseDeterministicFallback } from "./fallback.js";

const OPENAI_API_KEY = "sk-proj-faXoggacerMFffOc9eud8vn4nBywgmkk-MPZg_-pRZZOJcMr";

/**
 * Parses receipt OCR text and image into structured JSON using direct OpenAI or Anna SDK host capabilities.
 */
export async function runLlmParsing(ocrText, filename = "", imageUrl = "", options = {}) {
    const { anna, updateLlmStatusUI } = options;

    const prompt = `
Parse this receipt image (and/or OCR text) into JSON. Rules:
1. Return ONLY a valid JSON object. Do not include markdown wraps like \`\`\`json.
2. Use integer cents for all prices (e.g., $1.50 -> 150, $5,413.07 -> 541307, $300 -> 30000).
3. Ensure strict mathematical consistency:
   - The sum of all item total_prices MUST equal the 'subtotal' (or 'total' if subtotal is 0).
   - 'subtotal' + 'tax' + 'tip' - 'discount' MUST equal 'total'.
4. Handle ambiguous prices carefully: If a price has no decimal point (e.g., "$300"), analyze whether treating it as $3.00 (300 cents) or $300.00 (30000 cents) makes the sum of items equal the printed subtotal, and use the mathematically correct value.
5. Extract the date in YYYY-MM-DD format (e.g., "05-25-25" -> "2025-05-25").
6. Extract all readable text from the receipt image and put it as a raw string in the "ocr_text" field of the JSON. Make sure it is formatted neatly with correct line breaks.
7. Infer expense_category as: Groceries, Household, Personal Care, Electronics, Others.

JSON Schema:
{
  "merchant": { "name": "Store Name", "address": "Store Address" },
  "date": "YYYY-MM-DD",
  "time": "HH:MM",
  "currency": "EUR",
  "subtotal": 0,
  "tax": 0,
  "tip": 0,
  "discount": 0,
  "total": 0,
  "payment_method": "Card",
  "items": [
    { "name": "Item name", "quantity": 1, "unit_price": 0, "total_price": 0, "category": "Groceries" }
  ],
  "expense_category": "Groceries",
  "ocr_text": "Neatly formatted raw receipt text lines",
  "confidence": 95,
  "warnings": []
}

Receipt OCR text (use as secondary reference if the image is provided):
${ocrText}
`;

    // Direct OpenAI API Key fallback if configured
    if (typeof OPENAI_API_KEY !== "undefined" && OPENAI_API_KEY && OPENAI_API_KEY.startsWith("sk-")) {
        try {
            console.log("Attempting direct OpenAI API parser bypass...");
            
            const contentPayload = [{ type: "text", text: prompt }];
            if (imageUrl) {
                contentPayload.push({
                    type: "image_url",
                    image_url: { url: imageUrl }
                });
            }

            const response = await fetch("https://api.openai.com/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${OPENAI_API_KEY}`
                },
                body: JSON.stringify({
                    model: "gpt-4o-mini",
                    messages: [
                        { role: "user", content: contentPayload }
                    ],
                    temperature: 0.2
                })
            });

            if (response.ok) {
                const resultJson = await response.json();
                const rawJsonText = resultJson.choices[0].message.content.trim();
                const cleanedText = rawJsonText.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
                const parsed = jsonLooseParse(cleanedText);
                console.log("Direct OpenAI API parser bypass succeeded.", parsed);
                return parsed;
            } else {
                console.error("OpenAI direct API call failed with status", response.status);
            }
        } catch (directErr) {
            console.error("Failed to fetch from OpenAI directly:", directErr);
        }
    }

    if (anna && anna.llm) {
        try {
            const reply = await anna.llm.complete({
                messages: [
                    { role: "user", content: { type: "text", text: prompt } }
                ],
                maxTokens: 1024
            });
            
            const rawJsonText = reply.content.text.trim();
            const cleanedText = rawJsonText.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
            const parsed = jsonLooseParse(cleanedText);
            return parsed;
        } catch (llmErr) {
            console.warn("LLM complete failed, returning local mock parser.", llmErr);
        }
    }

    // Fallback path (Triggered when LLM is unavailable or throws)
    showToast(t("llmUnavailableFallback"), "warning");
    if (typeof updateLlmStatusUI === "function") {
        updateLlmStatusUI(false);
    }
    
    const fallbackObj = parseDeterministicFallback(filename, ocrText);
    return fallbackObj;
}

// Robust JSON parsing
export function jsonLooseParse(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        console.error("Direct JSON parse failed. Attempting regex extraction.", e);
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
            try {
                return JSON.parse(match[0]);
            } catch (innerE) {
                throw new Error("Unable to parse JSON from response.");
            }
        }
        throw e;
    }
}
