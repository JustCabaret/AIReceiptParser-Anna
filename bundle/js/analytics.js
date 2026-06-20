import { t } from "./translations.js";
import { escapeHtml } from "./utils.js";

export function renderDonutChart(breakdown) {
    const container = document.getElementById("categoryChartContainer");
    if (!container) return;
    
    if (!breakdown || breakdown.length === 0) {
        container.innerHTML = `<svg width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="transparent" stroke="var(--border-color)" stroke-width="8" /><text x="50" y="55" font-size="10px" fill="var(--text-secondary)" text-anchor="middle">No Data</text></svg>`;
        return;
    }
    
    const total = breakdown.reduce((sum, c) => sum + c.total, 0);
    if (total === 0) {
        container.innerHTML = `<svg width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="transparent" stroke="var(--border-color)" stroke-width="8" /><text x="50" y="55" font-size="10px" fill="var(--text-secondary)" text-anchor="middle">No Data</text></svg>`;
        return;
    }
    
    const size = 110;
    const center = size / 2;
    const radius = 40;
    const strokeWidth = 8;
    const circumference = 2 * Math.PI * radius;
    
    let svgHtml = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`;
    
    const catColors = {
        "Groceries": "#22c55e",      // green
        "Meals": "#f59e0b",          // amber
        "Transport": "#3b82f6",      // blue
        "Office Supplies": "#a855f7", // purple
        "Electronics": "#ec4899",    // pink
        "Travel": "#06b6d4",         // cyan
        "Household": "#84cc16",      // lime
        "Personal Care": "#10b981",  // emerald
        "Others": "#64748b"          // slate
    };
    const defaultColor = "#cbd5e1";
    
    let accumulatedOffset = 0;
    
    breakdown.forEach((c) => {
        const pct = c.total / total;
        const strokeLength = pct * circumference;
        const color = catColors[c.category] || defaultColor;
        
        svgHtml += `
            <circle
                cx="${center}"
                cy="${center}"
                r="${radius}"
                fill="transparent"
                stroke="${color}"
                stroke-width="${strokeWidth}"
                stroke-dasharray="${strokeLength} ${circumference}"
                stroke-dashoffset="${-accumulatedOffset}"
                transform="rotate(-90 ${center} ${center})"
            />
        `;
        accumulatedOffset += strokeLength;
    });
    
    svgHtml += `
        <circle cx="${center}" cy="${center}" r="${radius - strokeWidth/2 - 1}" fill="var(--bg-card)" />
        <text x="${center}" y="${center + 4}" font-size="11px" font-weight="bold" fill="var(--text-primary)" text-anchor="middle">
            €${(total / 100).toFixed(0)}
        </text>
    </svg>`;
    
    container.innerHTML = svgHtml;
}

export function renderMonthlySummaryUI(data, warningsCount = 0) {
    const statMonthlySpent = document.getElementById("statMonthlySpent");
    const statMonthlyTrend = document.getElementById("statMonthlyTrend");
    const statMonthlyScans = document.getElementById("statMonthlyScans");
    const statTopCategory = document.getElementById("statTopCategory");
    const statTopCategorySpent = document.getElementById("statTopCategorySpent");
    const statTopMerchant = document.getElementById("statTopMerchant");
    const statTopMerchantSpent = document.getElementById("statTopMerchantSpent");
    const categoryBreakdownList = document.getElementById("categoryBreakdownList");
    const warningsCountEl = document.getElementById("statWarningsCount");

    if (warningsCountEl) {
        warningsCountEl.textContent = warningsCount;
    }

    if (!data) {
        statMonthlySpent.textContent = "€0.00";
        statMonthlyTrend.textContent = "--";
        statMonthlyTrend.className = "stat-trend";
        statMonthlyScans.textContent = "0";
        statTopCategory.textContent = "-";
        statTopCategorySpent.textContent = "€0.00";
        statTopMerchant.textContent = "-";
        statTopMerchantSpent.textContent = "€0.00";
        categoryBreakdownList.innerHTML = `<div class="empty-state-small">${t("noAnalyticsData")}</div>`;
        renderDonutChart([]);
        return;
    }

    statMonthlySpent.textContent = `€${(data.total_spent / 100).toFixed(2)}`;
    statMonthlyScans.textContent = data.receipt_count;
    
    const topCatKey = "cat" + (data.top_category || "Others").replace(/\s+/g, "");
    statTopCategory.textContent = t(topCatKey) || data.top_category || "None";
    statTopMerchant.textContent = data.top_merchant || "None";

    // Percent trend vs last month
    const prev = data.previous_month || {};
    const pct = prev.percent_change || 0;
    const diff = prev.difference || 0;
    if (diff > 0) {
        statMonthlyTrend.textContent = `↑ €${(diff/100).toFixed(2)} (+${pct}% ${t("vsLastMonth")})`;
        statMonthlyTrend.className = "stat-trend up";
    } else if (diff < 0) {
        statMonthlyTrend.textContent = `↓ €${(Math.abs(diff)/100).toFixed(2)} (${pct}% ${t("vsLastMonth")})`;
        statMonthlyTrend.className = "stat-trend down";
    } else {
        statMonthlyTrend.textContent = `€0.00 (0% ${t("vsLastMonth")})`;
        statMonthlyTrend.className = "stat-trend";
    }

    // Sub labels spent
    const breakdown = data.by_category || [];
    const topCatObj = breakdown.find(c => c.category === data.top_category);
    statTopCategorySpent.textContent = topCatObj ? `€${(topCatObj.total / 100).toFixed(2)}` : "€0.00";
    statTopMerchantSpent.textContent = t("highestSpentMerchant");

    // Category progress breakdown bars
    categoryBreakdownList.innerHTML = "";
    if (breakdown.length === 0) {
        categoryBreakdownList.innerHTML = `<div class="empty-state-small">${t("noCategoryData")}</div>`;
    } else {
        const maxCatVal = Math.max(...breakdown.map(c => c.total), 1);
        const catColors = {
            "Groceries": "#22c55e",      // green
            "Meals": "#f59e0b",          // amber
            "Transport": "#3b82f6",      // blue
            "Office Supplies": "#a855f7", // purple
            "Electronics": "#ec4899",    // pink
            "Travel": "#06b6d4",         // cyan
            "Household": "#84cc16",      // lime
            "Personal Care": "#10b981",  // emerald
            "Others": "#64748b"          // slate
        };
        const defaultColor = "#64748b";

        breakdown.forEach(c => {
            const pctFill = Math.round((c.total / maxCatVal) * 100);
            const color = catColors[c.category] || defaultColor;
            
            const catNameKey = "cat" + c.category.replace(/\s+/g, "");
            const localizedCatName = t(catNameKey) || c.category;
            
            const item = document.createElement("div");
            item.className = "category-progress-item";
            item.innerHTML = `
                <div class="category-progress-info">
                    <span class="category-progress-name">${escapeHtml(localizedCatName)}</span>
                    <span class="category-progress-value">€${(c.total / 100).toFixed(2)} (${c.count} ${c.count === 1 ? t("scan") : t("scans")})</span>
                </div>
                <div class="category-progress-bar">
                    <div class="category-progress-fill" style="width: ${pctFill}%; background-color: ${color};"></div>
                </div>
            `;
            categoryBreakdownList.appendChild(item);
        });
    }

    renderDonutChart(breakdown);
}

export function renderComparisonResults(dataA, dataB) {
    const resultsContainer = document.getElementById("compareResultsContainer");
    if (!resultsContainer) return;
    
    const monthNames = [
        t("month0"), t("month1"), t("month2"), t("month3"),
        t("month4"), t("month5"), t("month6"), t("month7"),
        t("month8"), t("month9"), t("month10"), t("month11")
    ];
    const displayA = `${monthNames[dataA.month - 1]} ${dataA.year}`;
    const displayB = `${monthNames[dataB.month - 1]} ${dataB.year}`;
    
    // 1. General Metrics Comparison
    const spentDiff = dataA.total_spent - dataB.total_spent;
    let spentPct = 0;
    if (dataB.total_spent > 0) {
        spentPct = ((spentDiff / dataB.total_spent) * 100).toFixed(1);
    } else {
        spentPct = dataA.total_spent > 0 ? 100 : 0;
    }
    
    const scansDiff = dataA.receipt_count - dataB.receipt_count;
    const avgDiff = dataA.average_receipt - dataB.average_receipt;
    
    // Helper to format cents to EUR
    const fmt = (cents) => `€${(cents / 100).toFixed(2)}`;
    
    let spentTrendHtml = "";
    if (spentDiff > 0) {
        spentTrendHtml = `<span class="trend-badge badge-up">+${fmt(spentDiff)} (+${spentPct}%)</span>`;
    } else if (spentDiff < 0) {
        spentTrendHtml = `<span class="trend-badge badge-down">-${fmt(Math.abs(spentDiff))} (${spentPct}%)</span>`;
    } else {
        spentTrendHtml = `<span class="trend-badge badge-neutral">€0.00 (0%)</span>`;
    }
    
    let scansTrendHtml = "";
    if (scansDiff > 0) {
        scansTrendHtml = `<span class="trend-badge badge-neutral" style="color:#22c55e; background:rgba(34,197,94,0.1)">+${scansDiff} ${scansDiff === 1 ? t("scan") : t("scans")}</span>`;
    } else if (scansDiff < 0) {
        scansTrendHtml = `<span class="trend-badge badge-neutral" style="color:#ef4444; background:rgba(239,68,68,0.1)">-${Math.abs(scansDiff)} ${Math.abs(scansDiff) === 1 ? t("scan") : t("scans")}</span>`;
    } else {
        scansTrendHtml = `<span class="trend-badge badge-neutral">0 ${t("scansChange")}</span>`;
    }
    
    let avgTrendHtml = "";
    if (avgDiff > 0) {
        avgTrendHtml = `<span class="trend-badge badge-neutral" style="color:#ef4444; background:rgba(239,68,68,0.1)">+${fmt(avgDiff)}</span>`;
    } else if (avgDiff < 0) {
        avgTrendHtml = `<span class="trend-badge badge-neutral" style="color:#22c55e; background:rgba(34,197,94,0.1)">-${fmt(Math.abs(avgDiff))}</span>`;
    } else {
        avgTrendHtml = `<span class="trend-badge badge-neutral">€0.00</span>`;
    }
    
    // 2. Category Union
    const catsA = {};
    (dataA.by_category || []).forEach(c => { catsA[c.category] = c; });
    
    const catsB = {};
    (dataB.by_category || []).forEach(c => { catsB[c.category] = c; });
    
    const allCategoryNames = Array.from(new Set([
        ...Object.keys(catsA),
        ...Object.keys(catsB)
    ])).sort();
    
    let categoryRowsHtml = "";
    if (allCategoryNames.length === 0) {
        categoryRowsHtml = `<tr><td colspan="4" style="text-align:center; padding: 20px; color: var(--text-secondary);">${t("noCategoryData")}</td></tr>`;
    } else {
        const catColors = {
            "Groceries": "#22c55e",
            "Meals": "#f59e0b",
            "Transport": "#3b82f6",
            "Office Supplies": "#a855f7",
            "Electronics": "#ec4899",
            "Travel": "#06b6d4",
            "Household": "#84cc16",
            "Personal Care": "#10b981",
            "Others": "#64748b"
        };
        const defaultColor = "#64748b";
        
        allCategoryNames.forEach(catName => {
            const catA = catsA[catName] || { total: 0, count: 0 };
            const catB = catsB[catName] || { total: 0, count: 0 };
            
            const diffVal = catA.total - catB.total;
            let diffPct = 0;
            if (catB.total > 0) {
                diffPct = ((diffVal / catB.total) * 100).toFixed(1);
            } else {
                diffPct = catA.total > 0 ? 100 : 0;
            }
            
            let diffHtml = "";
            let diffClass = "";
            if (diffVal > 0) {
                diffHtml = `+${fmt(diffVal)} (+${diffPct}%)`;
                diffClass = "compare-val-up";
            } else if (diffVal < 0) {
                diffHtml = `-${fmt(Math.abs(diffVal))} (${diffPct}%)`;
                diffClass = "compare-val-down";
            } else {
                diffHtml = `€0.00 (0%)`;
                diffClass = "compare-val-neutral";
            }
            
            // Calculate progress fills
            const maxTotal = Math.max(catA.total, catB.total, 1);
            const pctA = Math.round((catA.total / maxTotal) * 100);
            const pctB = Math.round((catB.total / maxTotal) * 100);
            
            const color = catColors[catName] || defaultColor;
            
            const catNameKey = "cat" + catName.replace(/\s+/g, "");
            const localizedCatName = t(catNameKey) || catName;
            
            categoryRowsHtml += `
                <tr>
                    <td class="compare-cat-name-col">
                        <span class="color-indicator" style="background-color: ${color};"></span>
                        <strong>${escapeHtml(localizedCatName)}</strong>
                    </td>
                    <td>
                        <div class="compare-month-val">${fmt(catA.total)}</div>
                        <div class="compare-month-sub">${catA.count} ${catA.count === 1 ? t("scan") : t("scans")}</div>
                    </td>
                    <td>
                        <div class="compare-month-val">${fmt(catB.total)}</div>
                        <div class="compare-month-sub">${catB.count} ${catB.count === 1 ? t("scan") : t("scans")}</div>
                    </td>
                    <td>
                        <div class="compare-diff-val ${diffClass}">${diffHtml}</div>
                    </td>
                </tr>
                <tr class="progress-row-comparison">
                    <td colspan="4" style="padding-top:0px; padding-bottom:12px;">
                        <div class="comparison-bar-container">
                            <div class="comparison-bar-label">${displayA}:</div>
                            <div class="comparison-bar-track">
                                <div class="comparison-bar-fill" style="width: ${pctA}%; background-color: ${color};"></div>
                            </div>
                        </div>
                        <div class="comparison-bar-container" style="margin-top:4px;">
                            <div class="comparison-bar-label">${displayB}:</div>
                            <div class="comparison-bar-track">
                                <div class="comparison-bar-fill" style="width: ${pctB}%; background-color: ${color}; opacity: 0.6;"></div>
                            </div>
                        </div>
                    </td>
                </tr>
            `;
        });
    }
    
    resultsContainer.innerHTML = `
        <div class="compare-summary-cards">
            <div class="compare-summary-card">
                <div class="card-label">${t("totalSpendComparison")}</div>
                <div class="card-values">
                    <div class="val-a">${fmt(dataA.total_spent)} <span class="val-lbl">${displayA}</span></div>
                    <div class="val-b">${fmt(dataB.total_spent)} <span class="val-lbl">${displayB}</span></div>
                </div>
                <div class="card-trend">${spentTrendHtml}</div>
            </div>
            
            <div class="compare-summary-card">
                <div class="card-label">${t("receiptCountComparison")}</div>
                <div class="card-values">
                    <div class="val-a">${dataA.receipt_count} ${dataA.receipt_count === 1 ? t("scan") : t("scans")} <span class="val-lbl">${displayA}</span></div>
                    <div class="val-b">${dataB.receipt_count} ${dataB.receipt_count === 1 ? t("scan") : t("scans")} <span class="val-lbl">${displayB}</span></div>
                </div>
                <div class="card-trend">${scansTrendHtml}</div>
            </div>
            
            <div class="compare-summary-card">
                <div class="card-label">${t("averageTicketComparison")}</div>
                <div class="card-values">
                    <div class="val-a">${fmt(dataA.average_receipt)} <span class="val-lbl">${displayA}</span></div>
                    <div class="val-b">${fmt(dataB.average_receipt)} <span class="val-lbl">${displayB}</span></div>
                </div>
                <div class="card-trend">${avgTrendHtml}</div>
            </div>
        </div>
        
        <div class="card compare-details-card" style="margin-top: 24px; border: 1px solid var(--border-color); border-radius: var(--radius-lg); overflow: hidden;">
            <div class="card-header" style="background-color: var(--bg-card); padding: 16px; border-bottom: 1px solid var(--border-color);">
                <h3 style="margin:0; font-size:16px;">${t("compareBreakdown")}</h3>
            </div>
            <div class="card-body" style="padding: 0; background-color: var(--bg-card);">
                <table class="compare-table" style="width:100%; border-collapse:collapse;">
                    <thead>
                        <tr>
                            <th style="padding: 12px 16px; text-align:left; border-bottom:1px solid var(--border-color);">${t("category")}</th>
                            <th style="padding: 12px 16px; text-align:left; border-bottom:1px solid var(--border-color);">${displayA}</th>
                            <th style="padding: 12px 16px; text-align:left; border-bottom:1px solid var(--border-color);">${displayB}</th>
                            <th style="padding: 12px 16px; text-align:left; border-bottom:1px solid var(--border-color);">${t("difference")}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${categoryRowsHtml}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}
