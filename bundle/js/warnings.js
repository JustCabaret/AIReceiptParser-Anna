import { t } from "./translations.js";

export function getFriendlyWarning(w) {
    let code = "";
    let message = "";
    if (typeof w === "string") {
        message = w;
    } else if (w && typeof w === "object") {
        code = w.code || "";
        message = w.message || "";
    }
    
    const lowerMessage = message.toLowerCase();
    if (
        code === "TOTAL_MISMATCH" || 
        code === "ITEMS_SUM_MISMATCH" || 
        lowerMessage.includes("ocr") || 
        lowerMessage.includes("degrad") || 
        lowerMessage.includes("reconcil") || 
        lowerMessage.includes("cent") || 
        lowerMessage.includes("math") || 
        lowerMessage.includes("subtotal") || 
        lowerMessage.includes("total calculated")
    ) {
        return t("warningValidationGeneral");
    }
    
    if (code === "MISSING_FIELD") {
        if (lowerMessage.includes("merchant") || lowerMessage.includes("store")) {
            return t("warningMissingMerchant");
        }
        if (lowerMessage.includes("date")) {
            return t("warningMissingDate");
        }
        if (lowerMessage.includes("currency")) {
            return t("warningMissingCurrency");
        }
        if (lowerMessage.includes("total")) {
            return t("warningMissingTotal");
        }
    }
    
    if (code === "ITEM_INVALID") {
        if (lowerMessage.includes("description") || lowerMessage.includes("name")) {
            const match = message.match(/#(\d+)/);
            const index = match ? match[1] : "?";
            return t("warningMissingDescription").replace("{index}", index);
        }
        if (lowerMessage.includes("quantity") || lowerMessage.includes("qty")) {
            const match = message.match(/'([^']+)'/);
            const itemName = match ? match[1] : "?";
            if (lowerMessage.includes("zero") || lowerMessage.includes("negative")) {
                return t("warningNegativeQuantity").replace("{name}", itemName);
            }
            return t("warningMissingQuantity").replace("{name}", itemName);
        }
        if (lowerMessage.includes("price")) {
            const match = message.match(/'([^']+)'/);
            const itemName = match ? match[1] : "?";
            return t("warningNegativePrice").replace("{name}", itemName);
        }
    }
    
    if (lowerMessage.includes("deterministic local fallback") || lowerMessage.includes("disabled or unavailable")) {
        return t("warningLocalFallback");
    }
    
    return message;
}

export function showValidationWarnings(warnings) {
    const warningsPanel = document.getElementById("warningsPanel");
    const warningsList = document.getElementById("warningsList");
    warningsList.innerHTML = "";
    
    if (warnings.length > 0) {
        warningsPanel.classList.remove("hide");
        const friendlyWarningsSet = new Set();
        warnings.forEach(w => {
            const friendly = getFriendlyWarning(w);
            if (friendly) {
                friendlyWarningsSet.add(friendly);
            }
        });
        
        friendlyWarningsSet.forEach(fw => {
            const li = document.createElement("li");
            li.textContent = fw;
            warningsList.appendChild(li);
        });
    } else {
        warningsPanel.classList.add("hide");
    }
}
