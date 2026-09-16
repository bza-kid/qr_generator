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
    document.getElementById("qrText").value = "";
    document.getElementById("qrResult").classList.remove("active");

    clearCanvas();
    clearMessage();
    updateCharacterCount();
};

window.addEventListener("beforeunload", function () {
    clearCanvas();
});
