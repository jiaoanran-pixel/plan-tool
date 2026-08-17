/* 浏览器端 OCR（Tesseract.js，中文+英文，首次使用需联网下载语言包） */
"use strict";

let ocrWorker = null;

const Ocr = {
  async recognize(imageDataUrl, onProgress) {
    if (!window.Tesseract) {
      throw new Error("OCR 组件未加载，请检查网络后刷新页面");
    }
    if (!ocrWorker) {
      ocrWorker = await Tesseract.createWorker("chi_sim+eng", 1, {
        logger: (m) => {
          if (m.status === "recognizing text" && onProgress) {
            onProgress(m.progress);
          }
        },
      });
    }
    const { data } = await ocrWorker.recognize(imageDataUrl);
    return data.text || "";
  },
};
