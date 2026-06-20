import { t } from "./translations.js";

export function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export function showToast(msg, type = "info") {
    const toastArea = document.getElementById("toastArea");
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    toastArea.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.5s ease';
        setTimeout(() => toast.remove(), 500);
    }, 4500);
}

export function formatError(err) {
    if (!err) return "Unknown error";
    if (typeof err === "string") return err;
    if (err instanceof Error) return err.message;
    
    let message = "";
    let code = "";
    let details = "";
    
    const errorPayload = err.error || err;
    if (typeof errorPayload === "object" && errorPayload !== null) {
        message = errorPayload.message || "";
        code = errorPayload.code || "";
        details = errorPayload.details || "";
        
        if (!message && errorPayload.error) {
            message = typeof errorPayload.error === "string" ? errorPayload.error : JSON.stringify(errorPayload.error);
        }
    } else if (typeof errorPayload === "string") {
        message = errorPayload;
    }
    
    let formatted = "";
    if (code) formatted += `[Code: ${code}] `;
    if (message) formatted += message;
    else formatted += JSON.stringify(err);
    
    if (details) {
        if (typeof details === "string") {
            formatted += `\nDetails: ${details}`;
        } else {
            formatted += `\nDetails: ${JSON.stringify(details)}`;
        }
    }
    return formatted;
}

export function handleApiError(method, err) {
    console.error(`Error in method ${method}:`, err);
    const errorStr = formatError(err);
    showToast(`[Error] Method: ${method}\n${errorStr}`, "error");
}

export function base64ToBlob(base64, mimeType) {
    const byteCharacters = atob(base64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
}

export function downloadBase64File(content_b64, filename, mime_type) {
    try {
        const blob = base64ToBlob(content_b64, mime_type);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        
        showToast(t("downloadStarted").replace("{name}", filename), "success");
    } catch (err) {
        console.warn("Direct blob download failed. Displaying fallback window.", err);
    }
    
    // Always trigger visual fallback drawer as a backup to guarantee visibility!
    showExportFallback(content_b64, filename, mime_type);
}

export function showExportFallback(content_b64, filename, mime_type) {
    const noticeEl = document.getElementById("exportFallbackNotice");
    if (noticeEl) {
        noticeEl.innerHTML = t("sandboxNotice").replace("{filename}", filename);
    }
    document.getElementById("exportFallbackTitle").textContent = t("exportGenerated") + ": " + filename;
    
    const binSection = document.getElementById("exportFallbackBinSection");
    const textSection = document.getElementById("exportFallbackTextSection");
    const newTabLink = document.getElementById("exportFallbackNewTabLink");
    const textarea = document.getElementById("exportFallbackTextarea");
    
    if (mime_type === "text/csv") {
        binSection.classList.add("hide");
        textSection.classList.remove("hide");
        try {
            textarea.value = atob(content_b64);
        } catch (e) {
            textarea.value = "Error decoding Base64 CSV data.";
        }
    } else {
        textSection.classList.add("hide");
        binSection.classList.remove("hide");
        
        // Binary Base64 Data URI
        newTabLink.href = `data:${mime_type};base64,${content_b64}`;
        newTabLink.download = filename;
    }
    
    document.getElementById("exportFallbackModal").classList.add("active");
}

export function closeExportFallback() {
    document.getElementById("exportFallbackModal").classList.remove("active");
}
