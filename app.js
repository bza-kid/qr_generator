import QRCode from "qrcode";
import pako from "pako";
import { BrowserQRCodeReader } from "@zxing/browser";

const MAX_FILE_SIZE = 100_000_000;
const QR_PREFIX = "QFT1:";
const QR_SIZE = 420;

const panelIds = [
    "senderPanel",
    "receiverPanel",
    "qrPanel"
];

let selectedFile = null;

let senderPeerConnection = null;
let senderDataChannel = null;

let receiverPeerConnection = null;
let receiverDataChannel = null;

let scannerReader = null;
let scannerControls = null;
let scannerMode = null;
let scannerCompleted = false;

/*
 * No external STUN or TURN server is configured in this stage.
 * This first connection test is intended for two personal devices
 * on the same personal network.
 */
const rtcConfiguration = {
    iceServers: []
};

/* ---------------------------------------------------------------
   General panel controls
---------------------------------------------------------------- */

window.showPanel = function (panelId) {
    window.stopQrScanner();

    document.getElementById("choiceSection").style.display = "none";

    panelIds.forEach(function (id) {
        document.getElementById(id).classList.remove("active");
    });

    document.getElementById(panelId).classList.add("active");
};

window.showChoices = function () {
    const qrPanelWasActive =
        document.getElementById("qrPanel").classList.contains("active");

    window.stopQrScanner();

    panelIds.forEach(function (id) {
        document.getElementById(id).classList.remove("active");
    });

    document.getElementById("choiceSection").style.display = "block";

    if (qrPanelWasActive) {
        window.clearTextQrCode();
    }
};

/* ---------------------------------------------------------------
   Sender file selection
---------------------------------------------------------------- */

window.handleFileSelection = function () {
    const input = document.getElementById("sendFileInput");
    const details = document.getElementById("selectedFileDetails");
    const createButton = document.getElementById("createOfferButton");

    resetSenderConnectionOnly();

    if (!input.files || input.files.length === 0) {
        selectedFile = null;
        details.classList.remove("active");
        createButton.disabled = true;

        setStatus(
            "senderStatus",
            "Select a file to begin.",
            "waiting"
        );

        return;
    }

    const file = input.files[0];

    if (file.size > MAX_FILE_SIZE) {
        selectedFile = null;
        input.value = "";
        details.classList.remove("active");
        createButton.disabled = true;

        setStatus(
            "senderStatus",
            "The selected file exceeds the 100 MB limit.",
            "error"
        );

        return;
    }

    selectedFile = file;

    document.getElementById("selectedFileName").textContent =
        file.name;

    document.getElementById("selectedFileSize").textContent =
        formatFileSize(file.size);

    document.getElementById("selectedFileType").textContent =
        file.type || "Unknown file type";

    details.classList.add("active");
    createButton.disabled = false;

    setStatus(
        "senderStatus",
        "File selected. Create the connection QR.",
        "waiting"
    );
};

function formatFileSize(bytes) {
    if (bytes < 1000) {
        return `${bytes} bytes`;
    }

    if (bytes < 1_000_000) {
        return `${(bytes / 1000).toFixed(2)} kB`;
    }

    return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

/* ---------------------------------------------------------------
   Sender WebRTC offer
---------------------------------------------------------------- */

window.createSenderOffer = async function () {
    if (!selectedFile) {
        setStatus(
            "senderStatus",
            "Select a valid file first.",
            "error"
        );

        return;
    }

    resetSenderConnectionOnly();

    try {
        setStatus(
            "senderStatus",
            "Creating the sender connection offer...",
            "waiting"
        );

        senderPeerConnection =
            new RTCPeerConnection(rtcConfiguration);

        configureSenderPeerConnection(senderPeerConnection);

        senderDataChannel =
            senderPeerConnection.createDataChannel(
                "quick-file-transfer",
                {
                    ordered: true
                }
            );

        configureSenderDataChannel(senderDataChannel);

        const offer =
            await senderPeerConnection.createOffer();

        await senderPeerConnection.setLocalDescription(offer);
        await waitForIceGathering(senderPeerConnection);

        const payload = {
            version: 1,
            role: "offer",
            description:
                senderPeerConnection.localDescription.toJSON()
        };

        const encodedOffer = encodeSignal(payload);

        await drawConnectionQr(
            "senderOfferQr",
            encodedOffer
        );

        document
            .getElementById("senderOfferCard")
            .classList.add("active");

        document.getElementById("scanAnswerButton").disabled = false;
        document.getElementById("createOfferButton").disabled = true;

        setStatus(
            "senderStatus",
            "Offer QR created. Ask the receiver to scan it.",
            "waiting"
        );
    } catch (error) {
        console.error("Offer creation failed:", error);

        setStatus(
            "senderStatus",
            createReadableError(
                error,
                "The connection offer could not be created."
            ),
            "error"
        );

        resetSenderConnectionOnly();
    }
};

function configureSenderPeerConnection(peerConnection) {
    peerConnection.addEventListener(
        "connectionstatechange",
        function () {
            updateSenderConnectionState(
                peerConnection.connectionState
            );
        }
    );

    peerConnection.addEventListener(
        "iceconnectionstatechange",
        function () {
            console.log(
                "Sender ICE state:",
                peerConnection.iceConnectionState
            );
        }
    );
}

function configureSenderDataChannel(dataChannel) {
    dataChannel.binaryType = "arraybuffer";

    dataChannel.addEventListener("open", function () {
        setStatus(
            "senderStatus",
            "Connected. The connection test was successful.",
            "success"
        );

        dataChannel.send(
            JSON.stringify({
                type: "connection-test",
                message: "Sender data channel is open."
            })
        );
    });

    dataChannel.addEventListener("close", function () {
        if (senderPeerConnection) {
            setStatus(
                "senderStatus",
                "The connection was closed.",
                "waiting"
            );
        }
    });

    dataChannel.addEventListener("error", function (event) {
        console.error("Sender data channel error:", event);

        setStatus(
            "senderStatus",
            "A DataChannel error occurred.",
            "error"
        );
    });
}

function updateSenderConnectionState(state) {
    console.log("Sender connection state:", state);

    if (state === "connected") {
        setStatus(
            "senderStatus",
            "Connected. The connection test was successful.",
            "success"
        );

        return;
    }

    if (state === "connecting") {
        setStatus(
            "senderStatus",
            "Connecting to the receiver...",
            "waiting"
        );

        return;
    }

    if (state === "failed") {
        setStatus(
            "senderStatus",
            "Connection failed. Reset both devices and try again.",
            "error"
        );

        return;
    }

    if (state === "disconnected") {
        setStatus(
            "senderStatus",
            "The receiver disconnected.",
            "error"
        );

        return;
    }

    if (state === "closed") {
        setStatus(
            "senderStatus",
            "The sender session is closed.",
            "waiting"
        );
    }
}

/* ---------------------------------------------------------------
   Receiver WebRTC answer
---------------------------------------------------------------- */

async function processOfferQr(qrText) {
    try {
        setStatus(
            "receiverStatus",
            "Sender QR scanned. Creating the receiver answer...",
            "waiting"
        );

        const payload = decodeSignal(qrText);

        validateSignalPayload(payload, "offer");

        resetReceiverConnectionOnly();

        receiverPeerConnection =
            new RTCPeerConnection(rtcConfiguration);

        configureReceiverPeerConnection(receiverPeerConnection);

        await receiverPeerConnection.setRemoteDescription(
            payload.description
        );

        const answer =
            await receiverPeerConnection.createAnswer();

        await receiverPeerConnection.setLocalDescription(answer);
        await waitForIceGathering(receiverPeerConnection);

        const answerPayload = {
            version: 1,
            role: "answer",
            description:
                receiverPeerConnection.localDescription.toJSON()
        };

        const encodedAnswer = encodeSignal(answerPayload);

        await drawConnectionQr(
            "receiverAnswerQr",
            encodedAnswer
        );

        document
            .getElementById("receiverAnswerCard")
            .classList.add("active");

        setStatus(
            "receiverStatus",
            "Answer QR created. Ask the sender to scan it.",
            "waiting"
        );
    } catch (error) {
        console.error("Offer processing failed:", error);

        setStatus(
            "receiverStatus",
            createReadableError(
                error,
                "The sender QR could not be processed."
            ),
            "error"
        );

        resetReceiverConnectionOnly();
    }
}

function configureReceiverPeerConnection(peerConnection) {
    peerConnection.addEventListener(
        "datachannel",
        function (event) {
            receiverDataChannel = event.channel;
            configureReceiverDataChannel(receiverDataChannel);
        }
    );

    peerConnection.addEventListener(
        "connectionstatechange",
        function () {
            updateReceiverConnectionState(
                peerConnection.connectionState
            );
        }
    );

    peerConnection.addEventListener(
        "iceconnectionstatechange",
        function () {
            console.log(
                "Receiver ICE state:",
                peerConnection.iceConnectionState
            );
        }
    );
}

function configureReceiverDataChannel(dataChannel) {
    dataChannel.binaryType = "arraybuffer";

    dataChannel.addEventListener("open", function () {
        setStatus(
            "receiverStatus",
            "Connected. The connection test was successful.",
            "success"
        );
    });

    dataChannel.addEventListener("message", function (event) {
        if (typeof event.data !== "string") {
            return;
        }

        try {
            const message = JSON.parse(event.data);

            if (message.type === "connection-test") {
                setStatus(
                    "receiverStatus",
                    "Connected. Test message received from sender.",
                    "success"
                );
            }
        } catch {
            console.log(
                "Receiver received a non-JSON text message."
            );
        }
    });

    dataChannel.addEventListener("close", function () {
        if (receiverPeerConnection) {
            setStatus(
                "receiverStatus",
                "The sender closed the connection.",
                "waiting"
            );
        }
    });

    dataChannel.addEventListener("error", function (event) {
        console.error("Receiver data channel error:", event);

        setStatus(
            "receiverStatus",
            "A DataChannel error occurred.",
            "error"
        );
    });
}

function updateReceiverConnectionState(state) {
    console.log("Receiver connection state:", state);

    if (state === "connected") {
        setStatus(
            "receiverStatus",
            "Connected. The connection test was successful.",
            "success"
        );

        return;
    }

    if (state === "connecting") {
        setStatus(
            "receiverStatus",
            "Connecting to the sender...",
            "waiting"
        );

        return;
    }

    if (state === "failed") {
        setStatus(
            "receiverStatus",
            "Connection failed. Reset both devices and try again.",
            "error"
        );

        return;
    }

    if (state === "disconnected") {
        setStatus(
            "receiverStatus",
            "The sender disconnected.",
            "error"
        );

        return;
    }

    if (state === "closed") {
        setStatus(
            "receiverStatus",
            "The receiver session is closed.",
            "waiting"
        );
    }
}

/* ---------------------------------------------------------------
   Sender imports receiver answer
---------------------------------------------------------------- */

async function processAnswerQr(qrText) {
    if (!senderPeerConnection) {
        throw new Error(
            "Create the Sender Offer QR before scanning an Answer QR."
        );
    }

    try {
        const payload = decodeSignal(qrText);

        validateSignalPayload(payload, "answer");

        setStatus(
            "senderStatus",
            "Answer QR scanned. Establishing the connection...",
            "waiting"
        );

        await senderPeerConnection.setRemoteDescription(
            payload.description
        );
    } catch (error) {
        console.error("Answer processing failed:", error);

        setStatus(
            "senderStatus",
            createReadableError(
                error,
                "The receiver Answer QR could not be processed."
            ),
            "error"
        );

        throw error;
    }
}

/* ---------------------------------------------------------------
   ICE gathering
---------------------------------------------------------------- */

function waitForIceGathering(peerConnection) {
    if (peerConnection.iceGatheringState === "complete") {
        return Promise.resolve();
    }

    return new Promise(function (resolve, reject) {
        const timeout = window.setTimeout(function () {
            peerConnection.removeEventListener(
                "icegatheringstatechange",
                handleStateChange
            );

            reject(
                new Error(
                    "ICE gathering timed out. Reset and try again."
                )
            );
        }, 15_000);

        function handleStateChange() {
            if (
                peerConnection.iceGatheringState === "complete"
            ) {
                window.clearTimeout(timeout);

                peerConnection.removeEventListener(
                    "icegatheringstatechange",
                    handleStateChange
                );

                resolve();
            }
        }

        peerConnection.addEventListener(
            "icegatheringstatechange",
            handleStateChange
        );
    });
}

/* ---------------------------------------------------------------
   Connection QR encoding and decoding
---------------------------------------------------------------- */

function encodeSignal(payload) {
    const jsonText = JSON.stringify(payload);
    const compressed = pako.deflate(jsonText);

    return QR_PREFIX + bytesToBase64Url(compressed);
}

function decodeSignal(encodedText) {
    if (
        typeof encodedText !== "string" ||
        !encodedText.startsWith(QR_PREFIX)
    ) {
        throw new Error(
            "This is not a Quick Transfer connection QR code."
        );
    }

    const base64UrlText =
        encodedText.substring(QR_PREFIX.length);

    const compressedBytes =
        base64UrlToBytes(base64UrlText);

    const jsonText = pako.inflate(
        compressedBytes,
        {
            to: "string"
        }
    );

    return JSON.parse(jsonText);
}

function bytesToBase64Url(bytes) {
    let binaryText = "";
    const blockSize = 0x8000;

    for (
        let offset = 0;
        offset < bytes.length;
        offset += blockSize
    ) {
        const block = bytes.subarray(
            offset,
            Math.min(offset + blockSize, bytes.length)
        );

        binaryText += String.fromCharCode(...block);
    }

    return btoa(binaryText)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

function base64UrlToBytes(base64UrlText) {
    let base64Text = base64UrlText
        .replace(/-/g, "+")
        .replace(/_/g, "/");

    while (base64Text.length % 4 !== 0) {
        base64Text += "=";
    }

    const binaryText = atob(base64Text);
    const bytes = new Uint8Array(binaryText.length);

    for (let index = 0; index < binaryText.length; index++) {
        bytes[index] = binaryText.charCodeAt(index);
    }

    return bytes;
}

function validateSignalPayload(payload, expectedRole) {
    if (!payload || typeof payload !== "object") {
        throw new Error("The QR connection data is invalid.");
    }

    if (payload.version !== 1) {
        throw new Error(
            "The QR code uses an unsupported connection version."
        );
    }

    if (payload.role !== expectedRole) {
        throw new Error(
            `Expected a ${expectedRole} QR code.`
        );
    }

    if (
        !payload.description ||
        typeof payload.description.sdp !== "string" ||
        typeof payload.description.type !== "string"
    ) {
        throw new Error(
            "The QR code does not contain a valid session description."
        );
    }
}

async function drawConnectionQr(canvasId, encodedText) {
    const canvas = document.getElementById(canvasId);

    try {
        await QRCode.toCanvas(canvas, encodedText, {
            errorCorrectionLevel: "L",
            width: QR_SIZE,
            margin: 2,
            color: {
                dark: "#000000",
                light: "#ffffff"
            }
        });
    } catch (error) {
        if (
            String(error.message).toLowerCase().includes("too big") ||
            String(error.message).toLowerCase().includes("too large")
        ) {
            throw new Error(
                "The connection information is too large for one QR code."
            );
        }

        throw error;
    }
}

/* ---------------------------------------------------------------
   QR camera and screenshot scanner
---------------------------------------------------------------- */

window.startOfferScanner = function () {
    startQrScanner("offer");
};

window.startAnswerScanner = function () {
    if (!senderPeerConnection) {
        setStatus(
            "senderStatus",
            "Create the Sender Offer QR first.",
            "error"
        );

        return;
    }

    startQrScanner("answer");
};

async function startQrScanner(mode) {
    stopQrScanner();

    scannerMode = mode;
    scannerCompleted = false;

    document.getElementById("scannerImageInput").value = "";
    clearScannerError();

    document.getElementById("scannerTitle").textContent =
        mode === "offer"
            ? "Scan Sender Offer QR"
            : "Scan Receiver Answer QR";

    document.getElementById("scannerInstructions").textContent =
        mode === "offer"
            ? "Point the camera at the Offer QR shown by the sender."
            : "Point the camera at the Answer QR shown by the receiver.";

    document
        .getElementById("scannerOverlay")
        .classList.add("active");

    try {
        scannerReader = new BrowserQRCodeReader();

        scannerControls =
            await scannerReader.decodeFromConstraints(
                {
                    video: {
                        facingMode: {
                            ideal: "environment"
                        }
                    },
                    audio: false
                },
                document.getElementById("scannerVideo"),
                function (result, error, controls) {
                    if (result && !scannerCompleted) {
                        scannerCompleted = true;

                        const scannedText = result.getText();

                        controls.stop();
                        scannerControls = null;

                        closeScannerOverlay();

                        handleScannedConnectionQr(
                            scannedText,
                            mode
                        );
                    }

                    if (
                        error &&
                        error.name !== "NotFoundException"
                    ) {
                        console.debug(
                            "QR scanning status:",
                            error.name
                        );
                    }
                }
            );
    } catch (error) {
        console.error("Camera scanner failed:", error);

        showScannerError(
            "The camera could not be started. Allow camera permission " +
            "or select a QR-code screenshot below."
        );
    }
}

window.scanQrImageFile = async function () {
    const input =
        document.getElementById("scannerImageInput");

    if (!input.files || input.files.length === 0) {
        return;
    }

    const imageFile = input.files[0];
    const imageUrl = URL.createObjectURL(imageFile);

    try {
        const imageReader = new BrowserQRCodeReader();
        const result =
            await imageReader.decodeFromImageUrl(imageUrl);

        scannerCompleted = true;

        const scannedText = result.getText();
        const activeMode = scannerMode;

        stopQrScanner();

        await handleScannedConnectionQr(
            scannedText,
            activeMode
        );
    } catch (error) {
        console.error("QR image decoding failed:", error);

        showScannerError(
            "No readable QR code was found in the selected image."
        );
    } finally {
        URL.revokeObjectURL(imageUrl);
    }
};

async function handleScannedConnectionQr(
    scannedText,
    mode
) {
    try {
        if (mode === "offer") {
            await processOfferQr(scannedText);
            return;
        }

        if (mode === "answer") {
            await processAnswerQr(scannedText);
            return;
        }

        throw new Error("Unknown QR scanner mode.");
    } catch (error) {
        console.error("Scanned QR processing failed:", error);
    }
}

window.stopQrScanner = function () {
    if (scannerControls) {
        try {
            scannerControls.stop();
        } catch (error) {
            console.debug(
                "Scanner was already stopped:",
                error
            );
        }
    }

    scannerControls = null;
    scannerReader = null;
    scannerMode = null;
    scannerCompleted = false;

    stopVideoTracks();
    closeScannerOverlay();
};

function stopVideoTracks() {
    const video = document.getElementById("scannerVideo");

    if (video.srcObject) {
        video.srcObject
            .getTracks()
            .forEach(function (track) {
                track.stop();
            });

        video.srcObject = null;
    }
}

function closeScannerOverlay() {
    document
        .getElementById("scannerOverlay")
        .classList.remove("active");

    clearScannerError();
}

function showScannerError(message) {
    const errorBox =
        document.getElementById("scannerError");

    errorBox.textContent = message;
    errorBox.classList.add("active");
}

function clearScannerError() {
    const errorBox =
        document.getElementById("scannerError");

    errorBox.textContent = "";
    errorBox.classList.remove("active");
}

/* ---------------------------------------------------------------
   Sender and receiver reset
---------------------------------------------------------------- */

window.resetSenderSession = function () {
    stopQrScanner();
    resetSenderConnectionOnly();

    selectedFile = null;

    document.getElementById("sendFileInput").value = "";

    document
        .getElementById("selectedFileDetails")
        .classList.remove("active");

    document.getElementById("createOfferButton").disabled = true;
    document.getElementById("scanAnswerButton").disabled = true;

    clearCanvas("senderOfferQr");

    setStatus(
        "senderStatus",
        "Select a file to begin.",
        "waiting"
    );
};

function resetSenderConnectionOnly() {
    if (senderDataChannel) {
        try {
            senderDataChannel.close();
        } catch (error) {
            console.debug(
                "Sender data channel close error:",
                error
            );
        }
    }

    if (senderPeerConnection) {
        try {
            senderPeerConnection.close();
        } catch (error) {
            console.debug(
                "Sender peer connection close error:",
                error
            );
        }
    }

    senderDataChannel = null;
    senderPeerConnection = null;

    document
        .getElementById("senderOfferCard")
        .classList.remove("active");

    document.getElementById("scanAnswerButton").disabled = true;

    if (selectedFile) {
        document.getElementById("createOfferButton").disabled = false;
    }

    clearCanvas("senderOfferQr");
}

window.resetReceiverSession = function () {
    stopQrScanner();
    resetReceiverConnectionOnly();

    clearCanvas("receiverAnswerQr");

    setStatus(
        "receiverStatus",
        "Scan the Sender Offer QR to begin.",
        "waiting"
    );
};

function resetReceiverConnectionOnly() {
    if (receiverDataChannel) {
        try {
            receiverDataChannel.close();
        } catch (error) {
            console.debug(
                "Receiver data channel close error:",
                error
            );
        }
    }

    if (receiverPeerConnection) {
        try {
            receiverPeerConnection.close();
        } catch (error) {
            console.debug(
                "Receiver peer connection close error:",
                error
            );
        }
    }

    receiverDataChannel = null;
    receiverPeerConnection = null;

    document
        .getElementById("receiverAnswerCard")
        .classList.remove("active");

    clearCanvas("receiverAnswerQr");
}

/* ---------------------------------------------------------------
   Text and link QR generator
---------------------------------------------------------------- */

window.updateCharacterCount = function () {
    const text =
        document.getElementById("qrText").value;

    document.getElementById("characterCount").textContent =
        `${text.length} / 1000 characters`;
};

window.generateTextQrCode = async function () {
    const textBox = document.getElementById("qrText");
    const text = textBox.value.trim();
    const result =
        document.getElementById("textQrResult");
    const canvas =
        document.getElementById("textQrCanvas");

    clearQrMessage();
    result.classList.remove("active");
    clearCanvas("textQrCanvas");

    if (!text) {
        showQrMessage(
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

        showQrMessage(
            "QR code generated locally in this browser.",
            "success"
        );
    } catch (error) {
        console.error(
            "Text QR generation failed:",
            error
        );

        showQrMessage(
            "The QR code could not be generated. Try shorter text.",
            "error"
        );
    }
};

window.clearTextQrCode = function () {
    document.getElementById("qrLabel").value = "";
    document.getElementById("qrText").value = "";

    document
        .getElementById("textQrResult")
        .classList.remove("active");

    clearCanvas("textQrCanvas");
    clearQrMessage();
    updateCharacterCount();
};

window.downloadTextQrCode = function () {
    const qrCanvas =
        document.getElementById("textQrCanvas");

    const result =
        document.getElementById("textQrResult");

    const labelInput =
        document.getElementById("qrLabel");

    const textInput =
        document.getElementById("qrText");

    if (!result.classList.contains("active")) {
        showQrMessage(
            "Generate a QR code before downloading it.",
            "error"
        );

        return;
    }

    const encodedContent = textInput.value.trim();

    if (!encodedContent) {
        showQrMessage(
            "The QR-code content is empty.",
            "error"
        );

        return;
    }

    const displayLabel =
        labelInput.value.trim() ||
        createDefaultLabel(encodedContent);

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

    const downloadCanvas =
        document.createElement("canvas");

    const context =
        downloadCanvas.getContext("2d");

    downloadCanvas.width = imageWidth;
    downloadCanvas.height = imageHeight;

    context.fillStyle = "#ffffff";

    context.fillRect(
        0,
        0,
        imageWidth,
        imageHeight
    );

    context.drawImage(
        qrCanvas,
        50,
        35,
        qrSize,
        qrSize
    );

    context.fillStyle = "#172033";
    context.font =
        "bold 24px Arial, Helvetica, sans-serif";
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
    context.font =
        "15px Arial, Helvetica, sans-serif";

    context.fillText(
        createContentDescription(encodedContent),
        imageWidth / 2,
        labelBottom + 12
    );

    downloadCanvas.toBlob(function (blob) {
        if (!blob) {
            showQrMessage(
                "The QR image could not be prepared.",
                "error"
            );

            return;
        }

        downloadBlob(blob, displayLabel);

        showQrMessage(
            "Labelled QR code downloaded successfully.",
            "success"
        );
    }, "image/png");
}

function downloadBlob(blob, label) {
    const objectUrl = URL.createObjectURL(blob);
    const downloadLink =
        document.createElement("a");

    downloadLink.href = objectUrl;

    downloadLink.download =
        `${createSafeFileName(label)}.png`;

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

        return `${singleLineContent.substring(0, 57)}...`;
    }
}

function createContentDescription(content) {
    try {
        const url = new URL(content);

        if (
            url.protocol === "http:" ||
            url.protocol === "https:"
        ) {
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

        if (
            context.measureText(testLine).width <=
            maximumWidth
        ) {
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

    const visibleLines =
        lines.slice(0, maximumLines);

    if (lines.length > maximumLines) {
        let lastLine =
            visibleLines[maximumLines - 1];

        while (
            context.measureText(`${lastLine}...`).width >
                maximumWidth &&
            lastLine.length > 0
        ) {
            lastLine = lastLine.slice(0, -1);
        }

        visibleLines[maximumLines - 1] =
            `${lastLine.trim()}...`;
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

/* ---------------------------------------------------------------
   Shared utility functions
---------------------------------------------------------------- */

function setStatus(elementId, message, type) {
    const statusElement =
        document.getElementById(elementId);

    statusElement.textContent = message;
    statusElement.className = `status ${type}`;
}

function showQrMessage(message, type) {
    const messageElement =
        document.getElementById("qrMessage");

    messageElement.textContent = message;
    messageElement.className = `message ${type}`;
}

function clearQrMessage() {
    const messageElement =
        document.getElementById("qrMessage");

    messageElement.textContent = "";
    messageElement.className = "message";
}

function clearCanvas(canvasId) {
    const canvas =
        document.getElementById(canvasId);

    if (!canvas) {
        return;
    }

    const context = canvas.getContext("2d");

    context.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
    );
}

function createReadableError(error, fallbackMessage) {
    if (
        error &&
        typeof error.message === "string" &&
        error.message.trim()
    ) {
        return error.message;
    }

    return fallbackMessage;
}

/* ---------------------------------------------------------------
   Cleanup when page closes
---------------------------------------------------------------- */

window.addEventListener("beforeunload", function () {
    window.stopQrScanner();

    if (senderDataChannel) {
        senderDataChannel.close();
    }

    if (senderPeerConnection) {
        senderPeerConnection.close();
    }

    if (receiverDataChannel) {
        receiverDataChannel.close();
    }

    if (receiverPeerConnection) {
        receiverPeerConnection.close();
    }
});
