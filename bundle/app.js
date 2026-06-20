import { AnnaAppRuntime } from "/static/anna-apps/_sdk/latest/index.js";
import { currentLanguage, setCurrentLanguage, t, translateDOM } from "./js/translations.js";
import { getFriendlyWarning, showValidationWarnings } from "./js/warnings.js";
import { 
    formatBytes, 
    escapeHtml, 
    showToast, 
    formatError, 
    handleApiError, 
    downloadBase64File, 
    closeExportFallback 
} from "./js/utils.js";
import { 
    renderMonthlySummaryUI, 
    renderComparisonResults 
} from "./js/analytics.js";
import { runLlmParsing } from "./js/llm-parser.js";

const PARSER_TOOL_ID = (window.__ANNA_TOOL_IDS__ && window.__ANNA_TOOL_IDS__["receipt-parser-tool"]) || "tool-dev-receipt-parser";

// Global app state
let anna = null;
let currentView = "dashboard";
let dbStatus = { ready: false };
let activeReceiptId = null;
let deleteConfirmationActive = false;
let batchDeleteConfirmationActive = false;

// Image Zoom/Pan state
let zoomFactor = 1.0;
let isPanning = false;
let panStart = { x: 0, y: 0 };
let panOffset = { x: 0, y: 0 };

// V2 Global Filters, Batch Queue, and Draft states
let activeFilters = {
    date_from: "",
    date_to: "",
    category: "",
    merchant: ""
};
let currentMonthlySummary = null;
let currentReceiptDraft = null; // Holds the editable JSON struct before save
let batchQueue = [];
let isProcessingBatch = false;
let viewBeforeEditor = "dashboard";

function changeLanguage(lang) {
    setCurrentLanguage(lang);
    translateDOM();
    
    // Refresh active view
    switchView(currentView);
    if (currentView === "dashboard") {
        loadMonthlySummary();
    } else if (currentView === "history") {
        loadHistory();
    } else if (currentView === "compare") {
        loadCompareDropdowns();
    } else if (currentView === "status") {
        checkDependencies();
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    initUI();
    translateDOM();
    try {
        console.log("Connecting to AnnaAppRuntime...");
        anna = await AnnaAppRuntime.connect();
        console.log("Connected to Anna successfully. Capabilities:", anna.capabilities);
        showToast(t("connectedToHost"), "success");
        
        // Initial setup and check dependencies
        await checkDependencies();
        await checkLlmAvailability();
        await loadHistory();
        await loadMonthlySummary();
    } catch (err) {
        console.error("Failed to connect to Anna App Runtime SDK:", err);
        showToast(t("standaloneMode"), "warning");
        updateDepsStatusUI(false, t("offlineNoHost"));
        updateLlmStatusUI(false);
        renderMonthlySummaryUI(null);
    }
});

// UI elements and event listeners binding
function initUI() {
    // Navigation
    document.getElementById("navDashboardBtn").addEventListener("click", () => switchView("dashboard"));
    document.getElementById("navHistoryBtn").addEventListener("click", () => switchView("history"));
    document.getElementById("navCompareBtn").addEventListener("click", () => switchView("compare"));
    document.getElementById("navStatusBtn").addEventListener("click", () => switchView("status"));
    
    // Compare dropdown listeners
    document.getElementById("compareMonthA").addEventListener("change", runMonthComparison);
    document.getElementById("compareMonthB").addEventListener("change", runMonthComparison);
    
    // Language dropdown selection
    const langSelect = document.getElementById("langSelect");
    if (langSelect) {
        langSelect.value = currentLanguage;
        langSelect.addEventListener("change", (e) => {
            changeLanguage(e.target.value);
        });
    }
    
    // File inputs
    const browseBtn = document.getElementById("browseBtn");
    const fileInput = document.getElementById("fileInput");
    const dropzone = document.getElementById("uploadDropzone");
    
    browseBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", handleFileSelect);
    
    // Drag and drop
    dropzone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
    dropzone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropzone.classList.remove("dragover");
        if (e.dataTransfer.files.length > 0) {
            fileInput.files = e.dataTransfer.files;
            handleFileSelect();
        }
    });

    // Form actions
    document.getElementById("cancelEditBtn").addEventListener("click", cancelEdit);
    document.getElementById("receiptForm").addEventListener("submit", saveReceiptData);
    document.getElementById("addItemRowBtn").addEventListener("click", () => addItemRow());
    document.getElementById("toggleOcrBtn").addEventListener("click", toggleOcrPanel);
    
    // Drawer & Footer Actions
    document.getElementById("closeDrawerBtn").addEventListener("click", closeDetailsDrawer);
    document.getElementById("drawerOverlay").addEventListener("click", closeDetailsDrawer);
    document.getElementById("deleteReceiptBtn").addEventListener("click", deleteActiveReceipt);
    document.getElementById("editReceiptBtn").addEventListener("click", editActiveReceipt);
    
    // Export actions
    document.getElementById("exportSingleCsvBtn").addEventListener("click", exportSingleCsv);
    document.getElementById("exportAllCsvBtn").addEventListener("click", exportAllCsv);
    
    // Filter actions
    document.getElementById("applyFiltersBtn").addEventListener("click", applyFilters);
    document.getElementById("clearFiltersBtn").addEventListener("click", clearFilters);
    
    // Batch UI queue actions
    document.getElementById("clearBatchQueueBtn").addEventListener("click", clearBatchQueue);
    
    // Batch delete & Select all
    const selectAllCheckbox = document.getElementById("selectAllCheckbox");
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener("change", (e) => {
            const checked = e.target.checked;
            document.querySelectorAll(".row-checkbox").forEach(cb => {
                cb.checked = checked;
            });
            updateBatchDeleteButtonVisibility();
        });
    }
    
    const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");
    if (deleteSelectedBtn) {
        deleteSelectedBtn.addEventListener("click", deleteSelectedReceipts);
    }
    
    // Initialize zoom/pan listeners on receipt photo view
    initImageZoomPan();
    
    // Recalculations binds for manual editing of Tip & Discount
    document.getElementById("formTip").addEventListener("input", recalculateFormTotals);
    document.getElementById("formDiscount").addEventListener("input", recalculateFormTotals);
    document.getElementById("formTax").addEventListener("input", recalculateFormTotals);
    document.getElementById("formSubtotal").addEventListener("input", recalculateFormTotals);

    // Export Fallback Modal Binds
    document.getElementById("closeExportFallbackBtn").addEventListener("click", closeExportFallback);
    document.getElementById("dismissExportFallbackBtn").addEventListener("click", closeExportFallback);
    document.getElementById("exportFallbackOverlay").addEventListener("click", closeExportFallback);
    document.getElementById("copyExportTextBtn").addEventListener("click", () => {
        const textarea = document.getElementById("exportFallbackTextarea");
        textarea.select();
        document.execCommand("copy");
        showToast(t("copiedToClipboard"), "success");
    });
}

// Switching View panels
function switchView(viewName) {
    currentView = viewName;
    document.querySelectorAll(".view-section").forEach(s => s.classList.remove("active"));
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    
    const pageTitleEl = document.getElementById("pageTitle");
    
    if (viewName === "dashboard") {
        document.getElementById("dashboardView").classList.add("active");
        document.getElementById("navDashboardBtn").classList.add("active");
        if (pageTitleEl) pageTitleEl.textContent = t("dashboard");
        checkDependencies();
        loadMonthlySummary();
    } else if (viewName === "history") {
        document.getElementById("historyView").classList.add("active");
        document.getElementById("navHistoryBtn").classList.add("active");
        if (pageTitleEl) pageTitleEl.textContent = t("scannedHistory");
        loadHistory();
    } else if (viewName === "editor") {
        document.getElementById("editorView").classList.add("active");
        if (pageTitleEl) pageTitleEl.textContent = t("humanValidation");
    } else if (viewName === "status") {
        document.getElementById("statusView").classList.add("active");
        document.getElementById("navStatusBtn").classList.add("active");
        if (pageTitleEl) pageTitleEl.textContent = t("systemStatus");
        checkDependencies();
    } else if (viewName === "compare") {
        document.getElementById("compareView").classList.add("active");
        // Ensure active selector is handled correctly for sidebar buttons
        const compBtn = document.getElementById("navCompareBtn");
        if (compBtn) compBtn.classList.add("active");
        if (pageTitleEl) pageTitleEl.textContent = t("compareMonths");
        loadCompareDropdowns();
    }
}

// Dependencies verification
async function checkDependencies() {
    if (!anna) return;
    
    updateDepsStatusUI(null, t("checking"));
    try {
        const response = await anna.tools.invoke({
            tool_id: PARSER_TOOL_ID,
            method: "health",
            args: {}
        });
        
        console.log("Health check result:", response);
        const data = (response && response.data) ? response.data : response;
        if (data && data.status === "ready") {
            const hasOcr = data.pytesseract_available;
            let statusStr = t("ready");
            if (!hasOcr) {
                statusStr = t("readyTesseractMissing");
            }
            updateDepsStatusUI(true, statusStr, data);
            
            // Set SQLite Path in UI
            if (data.database_path) {
                document.getElementById("statDbPath").textContent = data.database_path;
            }
            if (data.python_executable) {
                document.getElementById("statPythonExe").textContent = data.python_executable;
            }
            if (data.python_version) {
                document.getElementById("statPythonVer").textContent = data.python_version;
            }
            if (data.opencv_available !== undefined) {
                const cvEl = document.getElementById("statOpenCv");
                cvEl.textContent = data.opencv_available ? t("active") : t("failed");
                cvEl.style.color = data.opencv_available ? "#22c55e" : "#ef4444";
            }
            if (data.openpyxl_available !== undefined) {
                const xlEl = document.getElementById("statOpenpyxl");
                xlEl.textContent = data.openpyxl_available ? t("active") : t("failed");
                xlEl.style.color = data.openpyxl_available ? "#22c55e" : "#ef4444";
            }
            if (data.reportlab_available !== undefined) {
                const pdfEl = document.getElementById("statReportlab");
                pdfEl.textContent = data.reportlab_available ? t("active") : t("failed");
                pdfEl.style.color = data.reportlab_available ? "#22c55e" : "#ef4444";
            }
        } else {
            updateDepsStatusUI(false, t("unhealthyCore"));
            if (response && response.success === false) {
                handleApiError("health", response);
            }
        }
    } catch (err) {
        console.error("Health check call failed:", err);
        updateDepsStatusUI(false, t("executaOffline"));
        handleApiError("health", err);
    }
}

function updateDepsStatusUI(ok, statusText, details = null) {
    const el = document.getElementById("statDeps");
    el.textContent = statusText;
    el.className = "status-val stat-status";
    
    if (ok === true) {
        el.classList.add("ready");
        
        const detailsData = details ? (details.data || details) : null;
        if (detailsData && detailsData.tesseract_available) {
            const ver = detailsData.tesseract_version || "Detected";
            el.textContent = `${t("ready")} (Tesseract: ${ver})`;
        } else if (detailsData) {
            el.textContent = t("readyTesseractMissing");
            
            const pathsChecked = detailsData.tesseract_detection_paths_checked || [];
            const statusCard = document.querySelector(".dependency-card");
            if (statusCard) {
                let tipEl = document.getElementById("tesseractInstallTip");
                if (!tipEl) {
                    tipEl = document.createElement("div");
                    tipEl.id = "tesseractInstallTip";
                    tipEl.style.fontSize = "11px";
                    tipEl.style.marginTop = "10px";
                    tipEl.style.color = "var(--color-warning)";
                    tipEl.style.borderTop = "1px solid var(--border-color)";
                    tipEl.style.paddingTop = "8px";
                    statusCard.querySelector(".card-body").appendChild(tipEl);
                }
                tipEl.innerHTML = `${t("tesseractNotDetected")}<br>${t("checkedPaths")}<br><span style="font-size:10px; opacity:0.8; word-break:break-all;">${pathsChecked.join('<br>')}</span>`;
            }
        }
    } else if (ok === false) {
        el.classList.add("error");
    }
}

// Loading History from SQLite with active filters
async function loadHistory() {
    if (!anna) return;
    
    try {
        const response = await anna.tools.invoke({
            tool_id: PARSER_TOOL_ID,
            method: "list_receipts",
            args: activeFilters
        });
        
        if (response && response.success === false) {
            throw response;
        }
        
        const receipts = response.receipts || [];
        renderHistoryTable(receipts);
    } catch (err) {
        console.error("Failed to load receipts list:", err);
        handleApiError("list_receipts", err);
        renderHistoryTable([]);
    }
}

function renderHistoryTable(receipts) {
    const tbody = document.getElementById("historyTableBody");
    const emptyState = document.getElementById("historyEmptyState");
    
    tbody.innerHTML = "";
    
    // Clear selectAll checkbox and batch delete button visibility
    const selectAllCheckbox = document.getElementById("selectAllCheckbox");
    if (selectAllCheckbox) selectAllCheckbox.checked = false;
    updateBatchDeleteButtonVisibility();
    
    if (receipts.length === 0) {
        emptyState.style.display = "flex";
        document.getElementById("historyTable").style.display = "none";
        return;
    }
    
    emptyState.style.display = "none";
    document.getElementById("historyTable").style.display = "table";
    
    receipts.forEach(r => {
        const tr = document.createElement("tr");
        const formattedDate = r.parsed_at ? r.parsed_at.substring(0, 10) : "N/A";
        const formattedTotal = (r.total / 100).toFixed(2);
        
        tr.innerHTML = `
            <td><input type="checkbox" class="row-checkbox" data-id="${r.id}"></td>
            <td>${formattedDate}</td>
            <td class="fw-semibold">${escapeHtml(r.store)}</td>
            <td class="fw-semibold">€${formattedTotal}</td>
            <td class="text-right">
                <button class="btn btn-secondary btn-small view-row-btn" data-id="${r.id}">${t("details")}</button>
            </td>
        `;
        
        // Clicking row opens details drawer
        tr.querySelector(".view-row-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            openDetailsDrawer(r.id);
        });
        
        tr.addEventListener("click", (e) => {
            // Do not open drawer if clicking on checkbox
            if (e.target.classList.contains("row-checkbox")) {
                return;
            }
            openDetailsDrawer(r.id);
        });
        
        const checkbox = tr.querySelector(".row-checkbox");
        checkbox.addEventListener("click", (e) => {
            e.stopPropagation(); // prevent opening details drawer
        });
        checkbox.addEventListener("change", () => {
            updateBatchDeleteButtonVisibility();
        });
        
        tbody.appendChild(tr);
    });
}

// Apply & Clear filters
function applyFilters() {
    activeFilters = {
        date_from: document.getElementById("filterDateFrom").value || "",
        date_to: document.getElementById("filterDateTo").value || "",
        category: document.getElementById("filterCategory").value || "",
        merchant: document.getElementById("filterMerchant").value || ""
    };
    loadHistory();
}

function clearFilters() {
    document.getElementById("filterDateFrom").value = "";
    document.getElementById("filterDateTo").value = "";
    document.getElementById("filterCategory").value = "";
    document.getElementById("filterMerchant").value = "";
    
    activeFilters = {
        date_from: "",
        date_to: "",
        category: "",
        merchant: ""
    };
    loadHistory();
}

// Monthly Summary Analytics Loader
async function loadMonthlySummary() {
    if (!anna) return;
    try {
        const response = await anna.tools.invoke({
            tool_id: PARSER_TOOL_ID,
            method: "get_monthly_summary",
            args: {} // default current month
        });
        
        if (response && response.success === false) {
            throw response;
        }

        // Fetch all receipts list to count warnings globally
        let warningsCount = 0;
        try {
            const listResponse = await anna.tools.invoke({
                tool_id: PARSER_TOOL_ID,
                method: "list_receipts",
                args: {}
            });
            if (listResponse && listResponse.success) {
                const allReceipts = listResponse.data && listResponse.data.receipts ? listResponse.data.receipts : (listResponse.receipts || []);
                allReceipts.forEach(r => {
                    if (r.warnings && Array.isArray(r.warnings)) {
                        warningsCount += r.warnings.length;
                    }
                });
            }
        } catch (warnErr) {
            console.error("Failed to count warnings:", warnErr);
        }
        
        currentMonthlySummary = response;
        renderMonthlySummaryUI(response, warningsCount);
    } catch (err) {
        console.error("Failed to load monthly summary:", err);
        renderMonthlySummaryUI(null, 0);
    }
}

// Processing File Selection for Batch sequential queue
async function handleFileSelect() {
    const fileInput = document.getElementById("fileInput");
    if (fileInput.files.length === 0) return;
    
    const files = Array.from(fileInput.files);
    
    // Add files to sequential queue
    batchQueue = files.map(file => ({
        id: Math.random().toString(36).substring(2, 9),
        file: file,
        name: file.name,
        size: formatBytes(file.size),
        status: "pending",
        error: ""
    }));

    // Toggle panels
    document.getElementById("batchQueuePanel").classList.remove("hide");
    document.getElementById("uploadDropzone").classList.add("hide");
    renderBatchQueue();
    
    // Process queue sequentially
    isProcessingBatch = true;
    processNextBatchQueueItem();
}

function renderBatchQueue() {
    const list = document.getElementById("batchQueueList");
    list.innerHTML = "";
    
    batchQueue.forEach(item => {
        const div = document.createElement("div");
        div.className = "batch-queue-item";
        
        let displayStatus = item.status;
        if (item.status === "uploading") displayStatus = t("uploading");
        else if (item.status === "ocr") displayStatus = t("ocr");
        else if (item.status === "ai-parsing") displayStatus = t("aiParsing");
        else if (item.status === "ready") displayStatus = t("ready");
        else if (item.status === "failed") displayStatus = t("failed");
        else if (item.status === "saved") displayStatus = t("saved");
        
        div.innerHTML = `
            <div class="batch-item-info">
                <span class="batch-item-name">${escapeHtml(item.name)}</span>
                <span class="batch-item-size">${item.size} ${item.error ? ' - <span style="color:var(--color-danger);">' + escapeHtml(item.error) + '</span>' : ''}</span>
            </div>
            <div class="batch-item-status status-${item.status}">${escapeHtml(displayStatus)}</div>
        `;
        list.appendChild(div);
    });
}

async function processNextBatchQueueItem() {
    const nextItem = batchQueue.find(item => item.status === "pending");
    
    if (!nextItem) {
        // No more items to start in the background
        return;
    }
    
    await processBatchItem(nextItem);
    
    // Process next item immediately in background
    processNextBatchQueueItem();
}

function showProcessing(show, text = "Processing...") {
    const ui = document.getElementById("processingUi");
    const dropzone = document.getElementById("uploadDropzone");
    const textEl = document.getElementById("processingStatusText");
    
    if (show) {
        ui.classList.remove("hide");
        dropzone.classList.add("hide");
        textEl.textContent = text;
    } else {
        ui.classList.add("hide");
        dropzone.classList.remove("hide");
        setProgress(0);
    }
}

function setProgress(percent) {
    document.getElementById("progressFill").style.width = `${percent}%`;
}

async function processBatchItem(item) {
    item.status = "uploading";
    renderBatchQueue();
    
    if (currentView !== "editor") {
        showProcessing(true, t("uploadingStatus") + " (" + item.name + ")");
        setProgress(25);
    }
    
    // Real OCR pipeline
    try {
        const reader = new FileReader();
        const base64Promise = new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result.split(",")[1]);
            reader.onerror = (err) => reject(err);
            reader.readAsDataURL(item.file);
        });
        const b64 = await base64Promise;
        const uploadResult = await anna.upload.inline({
            filename: item.name,
            mime_type: item.file.type,
            content_b64: b64,
            purpose: "image_input"
        });
        
        item.status = "ocr";
        renderBatchQueue();
        if (currentView !== "editor") {
            showProcessing(true, t("ocrStatus") + " (" + item.name + ")");
            setProgress(50);
        }
        
        const ocrResponse = await anna.tools.invoke({
            tool_id: PARSER_TOOL_ID,
            method: "parse_receipt_image",
            args: {
                image_url: uploadResult.download_url,
                mock_mode: false
            }
        });
        
        if (!ocrResponse.success) {
            throw ocrResponse;
        }
        
        item.status = "ai-parsing";
        renderBatchQueue();
        if (currentView !== "editor") {
            showProcessing(true, t("aiStatus") + " (" + item.name + ")");
            setProgress(75);
        }
        
        const dataUri = `data:${item.file.type};base64,${b64}`;
        const structuredReceipt = await runLlmParsing(ocrResponse.ocr_text, item.name, dataUri, { anna, updateLlmStatusUI });
        
        // Save the R2 transient download URL as image_url in draft data
        structuredReceipt.image_url = uploadResult.download_url;
        
        item.status = "ready";
        item.parsedData = structuredReceipt;
        item.rawOcrText = structuredReceipt.ocr_text || ocrResponse.ocr_text;
        renderBatchQueue();
        
        if (currentView !== "editor") {
            showProcessing(true, t("readyStatus") + " (" + item.name + ")");
            setProgress(100);
            
            setTimeout(() => {
                showProcessing(false);
                renderReceiptEditor(item.parsedData, item.rawOcrText);
                showToast(t("parsedOcrReady").replace("{name}", item.name), "success");
            }, 500);
        }
    } catch (err) {
        console.error(`Batch processing failed for ${item.name}:`, err);
        item.status = "failed";
        item.error = formatError(err);
        renderBatchQueue();
        
        if (currentView !== "editor") {
            showProcessing(false);
            showToast(t("failedToParse").replace("{name}", item.name), "error");
            showNextItemInQueue();
        }
    }
}

async function showNextItemInQueue() {
    if (!isProcessingBatch || batchQueue.length === 0) {
        switchView(viewBeforeEditor || "history");
        return;
    }
    
    const nextItem = batchQueue.find(item => item.status !== "saved" && item.status !== "failed");
    
    if (!nextItem) {
        isProcessingBatch = false;
        await loadHistory();
        await loadMonthlySummary();
        showToast(t("batchCompleted"), "info");
        switchView(viewBeforeEditor || "history");
        return;
    }
    
    if (nextItem.status === "ready") {
        showProcessing(false);
        renderReceiptEditor(nextItem.parsedData, nextItem.rawOcrText);
        showToast(t("parsedOcrReady").replace("{name}", nextItem.name), "success");
    } else {
        let displayStatus = t("uploadingStatus");
        if (nextItem.status === "ocr") displayStatus = t("ocrStatus");
        else if (nextItem.status === "ai-parsing") displayStatus = t("aiStatus");
        
        showProcessing(true, displayStatus + " (" + nextItem.name + ")");
        
        if (nextItem.status === "uploading") setProgress(25);
        else if (nextItem.status === "ocr") setProgress(50);
        else if (nextItem.status === "ai-parsing") setProgress(75);
        
        switchView("dashboard");
    }
}

function cancelEdit() {
    activeReceiptId = null; // Clear active receipt ID on cancel
    if (isProcessingBatch && batchQueue.length > 0) {
        const currentBatchItem = batchQueue.find(item => item.status === "ready");
        if (currentBatchItem) {
            currentBatchItem.status = "failed";
            currentBatchItem.error = "Cancelled";
            renderBatchQueue();
        }
        showNextItemInQueue();
    } else {
        switchView(viewBeforeEditor || "dashboard");
    }
}

function clearBatchQueue() {
    batchQueue = batchQueue.filter(item => item.status === "pending" || item.status === "uploading" || item.status === "ocr" || item.status === "ai-parsing");
    renderBatchQueue();
    if (batchQueue.length === 0) {
        document.getElementById("batchQueuePanel").classList.add("hide");
        document.getElementById("uploadDropzone").classList.remove("hide");
    }
}

// Populating, rendering and loading form editor (Common UI for Upload and Demo)
function renderReceiptEditor(draftData, ocrText) {
    if (currentView !== "editor") {
        viewBeforeEditor = currentView;
    }
    currentReceiptDraft = draftData;
    
    document.getElementById("rawOcrText").value = ocrText || draftData.ocr_text || "";
    
    // Fill editable fields
    document.getElementById("formMerchant").value = draftData.merchant?.name || draftData.store || "";
    document.getElementById("formDate").value = draftData.date || new Date().toISOString().split('T')[0];
    document.getElementById("formTime").value = draftData.time || "";
    document.getElementById("formCurrency").value = draftData.currency || "EUR";
    document.getElementById("formCategory").value = draftData.expense_category || "Others";
    
    // Reset zoom Factor and Panning Offset for interactive preview
    zoomFactor = 1.0;
    panOffset = { x: 0, y: 0 };
    
    const img = document.getElementById("editorReceiptImage");
    const imgContainer = document.getElementById("receiptImageContainer");
    const textarea = document.getElementById("rawOcrText");
    const btn = document.getElementById("toggleOcrBtn");
    const titleEl = document.getElementById("editorPaneTitle");
    
    if (img) {
        img.style.transform = "translate(0px, 0px) scale(1)";
        if (draftData.image_url) {
            img.src = draftData.image_url;
            img.style.display = "block";
            
            // Show Image container by default
            imgContainer.classList.remove("hide");
            textarea.classList.add("hide");
            btn.setAttribute("data-i18n", "viewOcrText");
            titleEl.setAttribute("data-i18n", "viewPhoto");
        } else {
            img.src = "";
            img.style.display = "none";
            
            // Show OCR Text area by default since no image is present
            imgContainer.classList.add("hide");
            textarea.classList.remove("hide");
            btn.setAttribute("data-i18n", "viewPhoto");
            titleEl.setAttribute("data-i18n", "ocrExtractedText");
        }
        translateDOM();
    }
    
    // Totals with Tip and Discount
    document.getElementById("formSubtotal").value = ((draftData.subtotal || 0) / 100).toFixed(2);
    document.getElementById("formTax").value = ((draftData.tax || 0) / 100).toFixed(2);
    document.getElementById("formTip").value = ((draftData.tip || 0) / 100).toFixed(2);
    document.getElementById("formDiscount").value = ((draftData.discount || 0) / 100).toFixed(2);
    document.getElementById("formTotal").value = ((draftData.total || 0) / 100).toFixed(2);
    
    // Confidence
    const confidenceBadge = document.getElementById("confidenceBadge");
    const confidence = draftData.confidence || 100;
    confidenceBadge.textContent = t("confidenceBadgeText").replace("{confidence}", confidence);
    confidenceBadge.style.backgroundColor = confidence > 80 ? "rgba(16, 185, 129, 0.15)" : "rgba(245, 158, 11, 0.15)";
    confidenceBadge.style.color = confidence > 80 ? "var(--color-accent)" : "var(--color-warning)";
    
    // Warnings
    const warnings = draftData.warnings || [];
    showValidationWarnings(warnings);
    
    // Items list
    const itemsTbody = document.getElementById("itemsTableBody");
    itemsTbody.innerHTML = "";
    
    const items = draftData.items || [];
    items.forEach(item => {
        addItemRow(item.name || item.product, item.quantity, ((item.unit_price || item.price || 0) / 100).toFixed(2));
    });
    
    if (items.length === 0) {
        addItemRow(); // empty starter row
    }
    
    switchView("editor");
}

function addItemRow(name = "", qty = 1, unitPrice = "0.00") {
    const tbody = document.getElementById("itemsTableBody");
    const tr = document.createElement("tr");
    
    const total = (parseFloat(qty) * parseFloat(unitPrice)).toFixed(2);
    
    tr.innerHTML = `
        <td><input type="text" class="item-name-input" value="${escapeHtml(name)}" required placeholder="${t("itemDescriptionPlaceholder")}"></td>
        <td><input type="number" class="item-qty-input" value="${qty}" min="1" step="1" required></td>
        <td><input type="number" class="item-price-input" value="${unitPrice}" min="0" step="0.01" required></td>
        <td><input type="number" class="item-total-input" value="${total}" readonly></td>
        <td><button type="button" class="btn-remove-row">&times;</button></td>
    `;
    
    const qtyInput = tr.querySelector(".item-qty-input");
    const priceInput = tr.querySelector(".item-price-input");
    const totalInput = tr.querySelector(".item-total-input");
    
    const recalculateRow = () => {
        const q = parseInt(qtyInput.value) || 0;
        const p = parseFloat(priceInput.value) || 0;
        totalInput.value = (q * p).toFixed(2);
        recalculateFormTotals();
    };
    
    qtyInput.addEventListener("input", recalculateRow);
    priceInput.addEventListener("input", recalculateRow);
    
    tr.querySelector(".btn-remove-row").addEventListener("click", () => {
        tr.remove();
        recalculateFormTotals();
    });
    
    tbody.appendChild(tr);
}

function recalculateFormTotals() {
    let subtotal = 0;
    const rows = document.querySelectorAll("#itemsTableBody tr");
    rows.forEach(row => {
        const rowTotal = parseFloat(row.querySelector(".item-total-input").value) || 0;
        subtotal += rowTotal;
    });
    
    document.getElementById("formSubtotal").value = subtotal.toFixed(2);
    const tax = parseFloat(document.getElementById("formTax").value) || 0;
    const tip = parseFloat(document.getElementById("formTip").value) || 0;
    const discount = parseFloat(document.getElementById("formDiscount").value) || 0;
    
    // grandTotal = subtotal + tax + tip - discount
    const grandTotal = subtotal + tax + tip - discount;
    document.getElementById("formTotal").value = grandTotal.toFixed(2);
}

function toggleOcrPanel() {
    const imgContainer = document.getElementById("receiptImageContainer");
    const textarea = document.getElementById("rawOcrText");
    const btn = document.getElementById("toggleOcrBtn");
    const titleEl = document.getElementById("editorPaneTitle");
    
    if (imgContainer.classList.contains("hide")) {
        // Show Image, Hide OCR text
        imgContainer.classList.remove("hide");
        textarea.classList.add("hide");
        btn.setAttribute("data-i18n", "viewOcrText");
        titleEl.setAttribute("data-i18n", "viewPhoto");
    } else {
        // Hide Image, Show OCR text
        imgContainer.classList.add("hide");
        textarea.classList.remove("hide");
        btn.setAttribute("data-i18n", "viewPhoto");
        titleEl.setAttribute("data-i18n", "ocrExtractedText");
    }
    translateDOM();
}

// Saving receipt form to SQLite using the actual editable field values!
async function saveReceiptData(e) {
    e.preventDefault();
    if (!anna) {
        showToast(t("connectionMissingCannotSave"), "error");
        return;
    }
    
    // Compile JSON object
    const items = [];
    document.querySelectorAll("#itemsTableBody tr").forEach(row => {
        const name = row.querySelector(".item-name-input").value;
        const qty = parseInt(row.querySelector(".item-qty-input").value) || 1;
        const price = Math.round(parseFloat(row.querySelector(".item-price-input").value) * 100) || 0;
        const total = Math.round(parseFloat(row.querySelector(".item-total-input").value) * 100) || 0;
        
        items.push({
            name: name,
            quantity: qty,
            unit_price: price,
            total_price: total,
            category: document.getElementById("formCategory").value
        });
    });
    
    const receiptObj = {
        id: activeReceiptId, // include ID if updating
        merchant: { name: document.getElementById("formMerchant").value },
        date: document.getElementById("formDate").value,
        time: document.getElementById("formTime").value,
        currency: document.getElementById("formCurrency").value,
        subtotal: Math.round(parseFloat(document.getElementById("formSubtotal").value) * 100),
        tax: Math.round(parseFloat(document.getElementById("formTax").value) * 100),
        tip: Math.round(parseFloat(document.getElementById("formTip").value) * 100) || 0,
        discount: Math.round(parseFloat(document.getElementById("formDiscount").value) * 100) || 0,
        total: Math.round(parseFloat(document.getElementById("formTotal").value) * 100),
        expense_category: document.getElementById("formCategory").value,
        image_url: currentReceiptDraft ? currentReceiptDraft.image_url : null,
        items: items
    };

    // Run Validation check first!
    try {
        const valRes = await anna.tools.invoke({
            tool_id: PARSER_TOOL_ID,
            method: "validate_receipt",
            args: { receipt: receiptObj }
        });

        if (valRes && valRes.success) {
            const warnings = valRes.warnings || [];
            
            // Block save ONLY if critical structure missing
            const isCriticalMissing = warnings.some(w => w.code === "MISSING_FIELD" && (w.message.includes("Merchant") || w.message.includes("date") || w.message.includes("total")));
            
            if (isCriticalMissing) {
                showToast(t("warningCriticalMissing"), "error");
                showValidationWarnings(warnings);
                return;
            }

            // Save warnings to the receipt object so they are persisted in SQLite
            receiptObj.warnings = warnings;
        }
    } catch (valErr) {
        console.warn("Validation call failed, saving anyway:", valErr);
    }
    
    try {
        const saveRes = await anna.tools.invoke({
            tool_id: PARSER_TOOL_ID,
            method: "save_receipt",
            args: { receipt: receiptObj }
        });
        
        if (saveRes && saveRes.success) {
            showToast(t("receiptSaved"), "success");
            activeReceiptId = null; // Clear active receipt ID after successful save
            
            if (isProcessingBatch && batchQueue.length > 0) {
                const currentBatchItem = batchQueue.find(item => item.status === "ready");
                if (currentBatchItem) {
                    currentBatchItem.status = "saved";
                    renderBatchQueue();
                }
                showNextItemInQueue();
                return;
            }
            switchView(viewBeforeEditor || "history");
        } else {
            throw saveRes;
        }
    } catch (err) {
        console.error("Failed to save receipt:", err);
        handleApiError("save_receipt", err);
    }
}

// Details drawer overlay
async function openDetailsDrawer(id) {
    activeReceiptId = id;
    
    try {
        const response = await anna.tools.invoke({
            tool_id: PARSER_TOOL_ID,
            method: "get_receipt_details",
            args: { receipt_id: id }
        });
        
        if (response && response.success === false) {
            throw response;
        }
        
        const receipt = response.receipt;
        if (!receipt) return;
        
        document.getElementById("drawerTitle").textContent = `${t("scanDetailsId")} (ID: ${receipt.id})`;
        document.getElementById("previewStore").textContent = receipt.store;
        document.getElementById("previewDate").textContent = `${t("date")}: ${receipt.parsed_at ? receipt.parsed_at.substring(0, 16) : "N/A"}`;
        
        const tbody = document.getElementById("previewItemsBody");
        tbody.innerHTML = "";
        
        receipt.items.forEach(item => {
            const tr = document.createElement("tr");
            const formattedPrice = (item.unit_price / 100).toFixed(2);
            const formattedTotal = ((item.unit_price * item.quantity) / 100).toFixed(2);
            tr.innerHTML = `
                <td>${escapeHtml(item.name)}</td>
                <td class="text-center">${item.quantity}</td>
                <td class="text-right">€${formattedPrice}</td>
                <td class="text-right">€${formattedTotal}</td>
            `;
            tbody.appendChild(tr);
        });
        
        // Subtotals, Tip, Discount, Total preview
        const tip = receipt.tip || 0;
        const discount = receipt.discount || 0;
        const subtotal = receipt.total - tip + discount;
        
        document.getElementById("previewSubtotal").textContent = `€${(subtotal / 100).toFixed(2)}`;
        
        const tipRow = document.getElementById("previewTipRow");
        if (tip > 0) {
            tipRow.style.display = "flex";
            document.getElementById("previewTip").textContent = `€${(tip / 100).toFixed(2)}`;
        } else {
            tipRow.style.display = "none";
        }
        
        const discountRow = document.getElementById("previewDiscountRow");
        if (discount > 0) {
            discountRow.style.display = "flex";
            document.getElementById("previewDiscount").textContent = `€${(discount / 100).toFixed(2)}`;
        } else {
            discountRow.style.display = "none";
        }
        
        document.getElementById("previewTotal").textContent = `€${(receipt.total / 100).toFixed(2)}`;
        
        // Warnings in Details preview
        const detailsWarningsPanel = document.getElementById("detailsWarningsPanel");
        const detailsWarningsList = document.getElementById("detailsWarningsList");
        detailsWarningsList.innerHTML = "";
        
        const warnings = receipt.warnings || [];
        if (warnings.length > 0) {
            detailsWarningsPanel.classList.remove("hide");
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
                detailsWarningsList.appendChild(li);
            });
        } else {
            detailsWarningsPanel.classList.add("hide");
        }
        
        document.getElementById("detailsDrawer").classList.add("active");
    } catch (err) {
        console.error("Failed to load details:", err);
        handleApiError("get_receipt_details", err);
    }
}

function closeDetailsDrawer() {
    document.getElementById("detailsDrawer").classList.remove("active");
    activeReceiptId = null;
    resetDeleteButton();
}

// Delete receipt
async function deleteActiveReceipt() {
    if (!activeReceiptId) return;
    
    if (!deleteConfirmationActive) {
        deleteConfirmationActive = true;
        const btn = document.getElementById("deleteReceiptBtn");
        if (btn) {
            btn.textContent = t("confirmDelete");
            btn.className = "btn btn-danger";
        }
        return;
    }
    
    try {
        const response = await anna.tools.invoke({
            tool_id: PARSER_TOOL_ID,
            method: "delete_receipt",
            args: { receipt_id: activeReceiptId }
        });
        if (response && response.success === false) {
            throw response;
        }
        showToast(t("receiptDeleted"), "success");
        closeDetailsDrawer();
        await loadHistory();
        await loadMonthlySummary();
    } catch (err) {
        console.error("Delete failed:", err);
        handleApiError("delete_receipt", err);
    } finally {
        resetDeleteButton();
    }
}

function resetDeleteButton() {
    deleteConfirmationActive = false;
    const btn = document.getElementById("deleteReceiptBtn");
    if (btn) {
        btn.textContent = t("deleteReceipt");
        btn.className = "btn btn-secondary";
    }
}

// Export single methods
async function exportSingleCsv() {
    if (!activeReceiptId) return;
    
    try {
        const response = await anna.tools.invoke({
            tool_id: PARSER_TOOL_ID,
            method: "export_receipts_csv",
            args: { receipt_id: activeReceiptId }
        });
        if (response && response.success === false) {
            throw response;
        }
        downloadBase64File(response.content_b64, response.filename, response.mime_type);
    } catch (err) {
        console.error("Single CSV export failed:", err);
        handleApiError("export_receipts_csv", err);
    }
}

// Export all methods
async function exportAllCsv() {
    try {
        const response = await anna.tools.invoke({
            tool_id: PARSER_TOOL_ID,
            method: "export_receipts_csv",
            args: {}
        });
        if (response && response.success === false) {
            throw response;
        }
        downloadBase64File(response.content_b64, response.filename, response.mime_type);
    } catch (err) {
        console.error("All CSV export failed:", err);
        handleApiError("export_receipts_csv", err);
    }
}

function updateLlmStatusUI(active) {
    const el = document.getElementById("statLlm");
    if (!el) return;
    if (active) {
        el.textContent = "Active";
        el.style.color = "#22c55e";
    } else {
        el.textContent = "Offline (Local Fallback)";
        el.style.color = "#f59e0b";
    }
}

async function checkLlmAvailability() {
    if (!anna || !anna.llm) {
        updateLlmStatusUI(false);
        return;
    }
    try {
        const response = await anna.llm.complete({
            messages: [{ role: "user", content: { type: "text", text: "healthcheck" } }],
            maxTokens: 1
        });
        updateLlmStatusUI(true);
    } catch (err) {
        console.warn("Harness LLM is disabled or unavailable. Using local fallback.");
        if (typeof OPENAI_API_KEY !== "undefined" && OPENAI_API_KEY && OPENAI_API_KEY.startsWith("sk-")) {
            const el = document.getElementById("statLlm");
            if (el) {
                el.textContent = "Active (Direct API Key)";
                el.style.color = "#22c55e";
            }
        } else {
            updateLlmStatusUI(false);
        }
    }
}

// Month dropdowns comparison
async function loadCompareDropdowns() {
    if (!anna) return;
    try {
        const response = await anna.tools.invoke({
            tool_id: PARSER_TOOL_ID,
            method: "list_receipts",
            args: {}
        });
        
        const receipts = (response && response.data && response.data.receipts) 
            ? response.data.receipts 
            : ((response && response.receipts) ? response.receipts : []);
            
        // Extract distinct year-months
        const monthsSet = new Set();
        receipts.forEach(r => {
            if (r.parsed_at && r.parsed_at.length >= 7) {
                monthsSet.add(r.parsed_at.substring(0, 7)); // 'YYYY-MM'
            }
        });
        
        const months = Array.from(monthsSet).sort().reverse(); // newer first
        
        const selectA = document.getElementById("compareMonthA");
        const selectB = document.getElementById("compareMonthB");
        
        if (!selectA || !selectB) return;
        
        // Save current selections to restore if possible
        const prevValA = selectA.value;
        const prevValB = selectB.value;
        
        selectA.innerHTML = "";
        selectB.innerHTML = "";
        
        if (months.length === 0) {
            selectA.innerHTML = `<option value="">${t("noData")}</option>`;
            selectB.innerHTML = `<option value="">${t("noData")}</option>`;
            document.getElementById("compareResultsContainer").innerHTML = `<div class="empty-state">${t("noReceiptsCompare")}</div>`;
            return;
        }
        
        const monthNames = [
            t("month0"), t("month1"), t("month2"), t("month3"),
            t("month4"), t("month5"), t("month6"), t("month7"),
            t("month8"), t("month9"), t("month10"), t("month11")
        ];
        
        months.forEach(ym => {
            const [y, m] = ym.split("-");
            const mIdx = parseInt(m) - 1;
            const display = `${monthNames[mIdx]} ${y}`;
            
            const optA = document.createElement("option");
            optA.value = ym;
            optA.textContent = display;
            selectA.appendChild(optA);
            
            const optB = document.createElement("option");
            optB.value = ym;
            optB.textContent = display;
            selectB.appendChild(optB);
        });
        
        // Restore previous values or select defaults
        if (prevValA && months.includes(prevValA)) {
            selectA.value = prevValA;
        } else {
            selectA.value = months[0];
        }
        
        if (prevValB && months.includes(prevValB)) {
            selectB.value = prevValB;
        } else {
            // Default to previous month if available, otherwise same month
            selectB.value = months[1] || months[0];
        }
        
        runMonthComparison();
    } catch (err) {
        console.error("Failed to load compare dropdowns:", err);
    }
}

async function runMonthComparison() {
    const ymA = document.getElementById("compareMonthA").value;
    const ymB = document.getElementById("compareMonthB").value;
    
    if (!ymA || !ymB) return;
    
    const resultsContainer = document.getElementById("compareResultsContainer");
    resultsContainer.innerHTML = `<div class="loading-state" style="text-align:center; padding: 40px; color: var(--text-secondary);">${t("calculatingComparison")}</div>`;
    
    try {
        const [yA, mA] = ymA.split("-");
        const [yB, mB] = ymB.split("-");
        
        // Invoke get_monthly_summary for both months
        const [resA, resB] = await Promise.all([
            anna.tools.invoke({
                tool_id: PARSER_TOOL_ID,
                method: "get_monthly_summary",
                args: { year: parseInt(yA), month: parseInt(mA) }
            }),
            anna.tools.invoke({
                tool_id: PARSER_TOOL_ID,
                method: "get_monthly_summary",
                args: { year: parseInt(yB), month: parseInt(mB) }
            })
        ]);
        
        if (!resA || !resB) {
            resultsContainer.innerHTML = `<div class="error-state" style="text-align:center; color: var(--color-danger); padding:20px;">${t("errorFetchSummary")}</div>`;
            return;
        }
        
        const dataA = (resA.data && resA.data.success !== false) ? resA.data : resA;
        const dataB = (resB.data && resB.data.success !== false) ? resB.data : resB;
        
        if (dataA.success === false || dataB.success === false) {
            resultsContainer.innerHTML = `<div class="error-state" style="text-align:center; color: var(--color-danger); padding:20px;">${t("errorCalcComparison")}</div>`;
            return;
        }
        
        renderComparisonResults(dataA, dataB);
    } catch (err) {
        console.error("Comparison error:", err);
        resultsContainer.innerHTML = `<div class="error-state" style="text-align:center; color: var(--color-danger); padding:20px;">${t("errorCalcComparison")}: ${err.message || err}</div>`;
    }
}

// Interactive Image Zoom/Pan helper
function initImageZoomPan() {
    const container = document.getElementById("receiptImageContainer");
    const img = document.getElementById("editorReceiptImage");
    const zoomInBtn = document.getElementById("zoomInBtn");
    const zoomOutBtn = document.getElementById("zoomOutBtn");
    const zoomResetBtn = document.getElementById("zoomResetBtn");
    
    if (!container || !img) return;
    
    const updateTransform = () => {
        img.style.transform = `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomFactor})`;
    };
    
    // Zoom buttons
    zoomInBtn.addEventListener("click", (e) => {
        e.preventDefault();
        zoomFactor = Math.min(zoomFactor + 0.25, 4.0);
        updateTransform();
    });
    
    zoomOutBtn.addEventListener("click", (e) => {
        e.preventDefault();
        zoomFactor = Math.max(zoomFactor - 0.25, 0.5);
        updateTransform();
    });
    
    zoomResetBtn.addEventListener("click", (e) => {
        e.preventDefault();
        zoomFactor = 1.0;
        panOffset = { x: 0, y: 0 };
        updateTransform();
    });
    
    // Mouse drag panning
    container.addEventListener("mousedown", (e) => {
        if (e.button !== 0) return; // Only left mouse click
        isPanning = true;
        container.style.cursor = "grabbing";
        panStart = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
        e.preventDefault();
    });
    
    window.addEventListener("mousemove", (e) => {
        if (!isPanning) return;
        panOffset = { x: e.clientX - panStart.x, y: e.clientY - panStart.y };
        updateTransform();
    });
    
    window.addEventListener("mouseup", () => {
        if (isPanning) {
            isPanning = false;
            container.style.cursor = "grab";
        }
    });
    
    // Prevent default drag behaviors on image
    img.addEventListener("dragstart", (e) => e.preventDefault());
}

// Batch deletion visibility update
function updateBatchDeleteButtonVisibility() {
    const checkedBoxes = document.querySelectorAll(".row-checkbox:checked");
    const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");
    
    // Reset batch delete confirmation state when selections change
    batchDeleteConfirmationActive = false;
    
    if (deleteSelectedBtn) {
        if (checkedBoxes.length > 0) {
            deleteSelectedBtn.classList.remove("hide");
            deleteSelectedBtn.textContent = t("deleteSelected");
            deleteSelectedBtn.className = "btn btn-danger btn-small";
        } else {
            deleteSelectedBtn.classList.add("hide");
        }
    }
    
    // Update selectAllCheckbox state
    const selectAllCheckbox = document.getElementById("selectAllCheckbox");
    if (selectAllCheckbox) {
        const allBoxes = document.querySelectorAll(".row-checkbox");
        if (allBoxes.length > 0 && checkedBoxes.length === allBoxes.length) {
            selectAllCheckbox.checked = true;
        } else {
            selectAllCheckbox.checked = false;
        }
    }
}

// Batch deletion action handler
async function deleteSelectedReceipts() {
    const checkedBoxes = document.querySelectorAll(".row-checkbox:checked");
    const count = checkedBoxes.length;
    if (count === 0) return;
    
    const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");
    
    if (!batchDeleteConfirmationActive) {
        batchDeleteConfirmationActive = true;
        if (deleteSelectedBtn) {
            const confirmLabel = currentLanguage === "zh" 
                ? `确认删除 (${count})？` 
                : `Confirm Delete (${count})?`;
            deleteSelectedBtn.textContent = confirmLabel;
            deleteSelectedBtn.className = "btn btn-danger btn-small";
        }
        return;
    }
    
    // Reset confirmation state
    batchDeleteConfirmationActive = false;
    if (deleteSelectedBtn) {
        deleteSelectedBtn.textContent = t("deleteSelected");
    }
    
    showToast("Deleting selected receipts...", "info");
    
    let deletedCount = 0;
    let failedCount = 0;
    
    for (const cb of checkedBoxes) {
        const id = cb.getAttribute("data-id");
        try {
            const response = await anna.tools.invoke({
                tool_id: PARSER_TOOL_ID,
                method: "delete_receipt",
                args: { receipt_id: parseInt(id) }
            });
            if (response && (response.success || (response.data && response.data.success) || response.success !== false)) {
                deletedCount++;
            } else {
                failedCount++;
            }
        } catch (err) {
            console.error(`Failed to delete receipt ${id}:`, err);
            failedCount++;
        }
    }
    
    if (deletedCount > 0) {
        showToast(`${deletedCount} receipts deleted successfully.`, "success");
    }
    if (failedCount > 0) {
        showToast(`Failed to delete ${failedCount} receipts.`, "error");
    }
    
    const selectAllCheckbox = document.getElementById("selectAllCheckbox");
    if (selectAllCheckbox) selectAllCheckbox.checked = false;
    
    loadHistory();
    loadMonthlySummary();
}

// Edit saved receipt detail loader
async function editActiveReceipt() {
    if (!activeReceiptId) return;
    const idToEdit = activeReceiptId;
    
    try {
        const response = await anna.tools.invoke({
            tool_id: PARSER_TOOL_ID,
            method: "get_receipt_details",
            args: { receipt_id: idToEdit }
        });
        
        if (response && response.success === false) {
            throw response;
        }
        
        const receipt = (response.data && response.data.receipt) ? response.data.receipt : response.receipt;
        if (!receipt) return;
        
        closeDetailsDrawer();
        activeReceiptId = idToEdit;
        
        const draftData = {
            id: receipt.id,
            store: receipt.store,
            date: receipt.parsed_at ? receipt.parsed_at.substring(0, 10) : "",
            time: receipt.parsed_at && receipt.parsed_at.length > 15 ? receipt.parsed_at.substring(11, 16) : "",
            currency: receipt.currency || "EUR",
            expense_category: receipt.expense_category || "Others",
            subtotal: receipt.total - (receipt.tip || 0) + (receipt.discount || 0),
            tax: 0,
            tip: receipt.tip || 0,
            discount: receipt.discount || 0,
            total: receipt.total || 0,
            items: receipt.items || [],
            image_url: receipt.image_url || null,
            warnings: receipt.warnings || []
        };
        
        renderReceiptEditor(draftData, "");
    } catch (err) {
        console.error("Failed to load details for editing:", err);
        handleApiError("get_receipt_details", err);
    }
}
