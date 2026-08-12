#!/bin/zsh
# 编译 macOS Vision OCR 辅助程序
set -e
cd "$(dirname "$0")"
clang -fobjc-arc \
  -framework Foundation \
  -framework Vision \
  -framework AppKit \
  -o ocr_helper ocr_helper.m
echo "编译完成：$(pwd)/ocr_helper"
