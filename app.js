import QRCode from "qrcode";

const panelIds = [
    "senderPanel",
    "receiverPanel",
    "qrPanel"
];

window.showPanel = function (panelId) {
    document.getElementById("choiceSection").style.display = "none";

    panelIds.forEach(function (id) {
        document.getElementById(id).classList.remove("active");
    });

    document.getElementById(panelId).classList.add("active");
};

window.showChoices = function () {
    const qrPanelWasActive =
        document.getElementById("qrPanel").classList.contains("active");

    panelIds.forEach(function (id) {
        document.getElementById(id).classList.remove("active");
    });

    document.getElementById("choiceSection").style.display = "block";

    if (qrPanelWasActive) {
        clearQrCode();
    }
};

window.updateCharacterCount = function () {
    const text = document.getElementById("qrText").value;
    const counter = document.getElementById("characterCount");

    counter.textContent = `${text.length} / 1000 characters`;
};

function showMessage(message, type) {
    const messageBox = document.getElementById("qrMessage");

    messageBox.textContent = message;
    messageBox.className = `message ${type}`;
}

function clearMessage() {
    const messageBox = document.getElementById("qrMessage");

    messageBox.textContent = "";
    messageBox.className = "message";
}

function clearCanvas() {
    const canvas = document.getElementById("qrCanvas");
    const context = canvas.getContext("2d");

    context.clearRect(0, 0, canvas.width, canvas.height);
}

window.generateQrCode = async function () {
    const textBox = document.getElementById("qrText");
    const text = textBox.value.trim();
    const result = document.getElementById("qrResult");
    const canvas = document.getElementById("qrCanvas");

    clearMessage();
    result.classList.remove("active");
    clearCanvas();

    if (!text) {
        showMessage(
            "Enter some text or a website link first.",
            "error"
        );

        textBox.focus();
        return;
    }

    try {
        await QRCode.toCanvas(canvas, text, {
            errorCorrectionLevel: "M",
            width: 320,
            margin: 2,
            color: {
                dark: "#000000",
                light: "#ffffff"
            }
        });

        result.classList.add("active");

        showMessage(
            "QR code generated locally in this browser.",
            "success"
        );
    } catch (error) {
        console.error("QR-code generation failed:", error);

        showMessage(
            "The QR code could not be generated. Try using shorter text.",
            "error"
        );
    }
};

window.clearQrCode = function () {
    document.getElementById("qrLabel").value = "";
    document.getElementById("qrText").value = "";
    document.getElementById("qrResult").classList.remove("active");

    clearCanvas();
    clearMessage();
    updateCharacterCount();
};

window.downloadQrCode = function () {
    const qrCanvas = document.getElementById("qrCanvas");
    const result = document.getElementById("qrResult");
    const labelInput = document.getElementById("qrLabel");
    const qrTextInput = document.getElementById("qrText");

    if (!result.classList.contains("active")) {
        showMessage(
            "Generate a QR code before downloading it.",
            "error"
        );
        return;
    }

    const enteredLabel = labelInput.value.trim();
    const encodedContent = qrTextInput.value.trim();

    if (!encodedContent) {
        showMessage(
            "The QR-code content is empty. Generate the QR code again.",
            "error"
        );
        return;
    }

    const displayLabel =
        enteredLabel || createDefaultLabel(encodedContent);

    createLabelledQrImage(
        qrCanvas,
        displayLabel,
        encodedContent
    );
};

function createLabelledQrImage(
    qrCanvas,
    displayLabel,
    encodedContent
) {
    const imageWidth = 500;
    const imageHeight = 600;
    const qrSize = 400;
    const qrPositionX = (imageWidth - qrSize) / 2;
    const qrPositionY = 35;

    const downloadCanvas = document.createElement("canvas");
    const context = downloadCanvas.getContext("2d");

    downloadCanvas.width = imageWidth;
    downloadCanvas.height = imageHeight;

    context.fillStyle = "#ffffff";
    context.fillRect(
        0,
        0,
        downloadCanvas.width,
        downloadCanvas.height
    );

    context.drawImage(
        qrCanvas,
        qrPositionX,
        qrPositionY,
        qrSize,
        qrSize
    );

    context.fillStyle = "#172033";
    context.font = "bold 24px Arial, Helvetica, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "top";

    const labelBottom = drawWrappedText(
        context,
        displayLabel,
        imageWidth / 2,
        465,
        430,
        30,
        2
    );

    context.fillStyle = "#667085";
    context.font = "15px Arial, Helvetica, sans-serif";

    context.fillText(
        createContentDescription(encodedContent),
        imageWidth / 2,
        labelBottom + 12
    );

    downloadCanvas.toBlob(function (blob) {
        if (!blob) {
            showMessage(
                "The QR code could not be prepared for download.",
                "error"
            );
            return;
        }

        downloadBlob(blob, displayLabel);

        showMessage(
            "Labelled QR code downloaded successfully.",
            "success"
        );
    }, "image/png");
}

function downloadBlob(blob, displayLabel) {
    const objectUrl = URL.createObjectURL(blob);
    const downloadLink = document.createElement("a");

    downloadLink.href = objectUrl;
    downloadLink.download =
        createSafeFileName(displayLabel) + ".png";

    document.body.appendChild(downloadLink);

    downloadLink.click();
    downloadLink.remove();

    window.setTimeout(function () {
        URL.revokeObjectURL(objectUrl);
    }, 1000);
}

function createDefaultLabel(content) {
    try {
        const url = new URL(content);

        return url.hostname.replace(/^www\./, "");
    } catch {
        const singleLineContent = content
            .replace(/\s+/g, " ")
            .trim();

        if (singleLineContent.length <= 60) {
            return singleLineContent;
        }

        return singleLineContent.substring(0, 57) + "...";
    }
}

function createContentDescription(content) {
    try {
        const url = new URL(content);

        if (url.protocol === "http:" || url.protocol === "https:") {
            return "Scan to open link";
        }
    } catch {
        return "Scan to view text";
    }

    return "Scan to view content";
}

function createSafeFileName(label) {
    const safeName = label
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase()
        .substring(0, 60);

    return safeName || "qr-code";
}

function drawWrappedText(
    context,
    text,
    centerX,
    startY,
    maximumWidth,
    lineHeight,
    maximumLines
) {
    const words = text.split(/\s+/);
    const lines = [];
    let currentLine = "";

    for (const word of words) {
        const testLine = currentLine
            ? `${currentLine} ${word}`
            : word;

        const testWidth = context.measureText(testLine).width;

        if (testWidth <= maximumWidth) {
            currentLine = testLine;
        } else {
            if (currentLine) {
                lines.push(currentLine);
            }

            currentLine = word;
        }
    }

    if (currentLine) {
        lines.push(currentLine);
    }

    const visibleLines = lines.slice(0, maximumLines);

    if (lines.length > maximumLines) {
        let lastLine = visibleLines[maximumLines - 1];

        while (
            context.measureText(lastLine + "...").width >
                maximumWidth &&
            lastLine.length > 0
        ) {
            lastLine = lastLine.slice(0, -1);
        }

        visibleLines[maximumLines - 1] =
            lastLine.trim() + "...";
    }

    visibleLines.forEach(function (line, index) {
        context.fillText(
            line,
            centerX,
            startY + index * lineHeight
        );
    });

    return startY + visibleLines.length * lineHeight;
}

window.addEventListener("beforeunload", function () {
    clearCanvas();
});
