#!/bin/zsh
# 端到端接口测试：剪贴板解析 -> 建计划 -> OCR 识别 -> 自动填入 -> 统计 -> 导出
set -e
B=${B:-http://127.0.0.1:8766}
D="$(cd "$(dirname "$0")" && pwd)"

echo "--- 1. 剪贴板解析 ---"
TXT=$(<"$D/sample_paste.txt")
python3 -c "import json,sys; print(json.dumps({'text': sys.stdin.read()}, ensure_ascii=False))" <<< "$TXT" | curl -s -X POST "$B/api/parse_text" -H 'Content-Type: application/json' -d @- | python3 -m json.tool

echo "--- 2. 创建计划 ---"
PLAN_JSON=$(curl -s -X POST "$B/api/plans" -H 'Content-Type: application/json' -d '{
  "load_date": "2026-08-12",
  "truck_no": "冀J0B318",
  "gas_source": "正安",
  "supplier": "浙江禾兴",
  "station": "宜章西东站",
  "plan_arrive": "2026-08-13T19:00",
  "price": 5900,
  "trailer_no": "冀JM09D挂",
  "driver_name": "余佑江",
  "driver_phone": "17783662621",
  "carrier": "沧州市安兴特种货物运输有限公司"
}')
echo "$PLAN_JSON"
PLAN_ID=$(echo "$PLAN_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['plan']['id'])")

echo "--- 3. OCR 卸车磅单并自动填入 ---"
IMG=$(python3 -c "
import base64
print(base64.b64encode(open('$D/images/unload.png','rb').read()).decode())
")
OCR1=$(curl -s -X POST "$B/api/ocr" -H 'Content-Type: application/json' -d "{\"image_base64\": \"$IMG\"}")
print -r -- "$OCR1" | python3 -c "import json,sys; d=json.load(sys.stdin); print('type:', d['parsed']['doc_type'], '| truck:', d['parsed']['truck_no'], '| date:', d['parsed']['load_date'], '| net:', d['parsed']['net_weight'], '| candidates:', len(d['candidates']))"
NW=$(print -r -- "$OCR1" | python3 -c "import json,sys; print(json.load(sys.stdin)['parsed']['net_weight'] or '')")
curl -s -X POST "$B/api/attach" -H 'Content-Type: application/json' -d "{\"plan_id\": \"$PLAN_ID\", \"doc_type\": \"unload\", \"image_base64\": \"$IMG\", \"net_weight\": $NW}" | python3 -c "import json,sys; d=json.load(sys.stdin); print('net_weight:', d['plan']['net_weight'], '| amount:', d['plan']['amount'])"

echo "--- 4. OCR 运单 ---"
IMG2=$(python3 -c "
import base64
print(base64.b64encode(open('$D/images/waybill.png','rb').read()).decode())
")
curl -s -X POST "$B/api/ocr" -H 'Content-Type: application/json' -d "{\"image_base64\": \"$IMG2\"}" | python3 -c "import json,sys; d=json.load(sys.stdin); print('type:', d['parsed']['doc_type'], '| truck:', d['parsed']['truck_no'], '| date:', d['parsed']['load_date'], '| candidates:', len(d['candidates']))"

echo "--- 5. 手工关联运单到计划 ---"
IMG2=$(python3 -c "
import base64
print(base64.b64encode(open('$D/images/waybill.png','rb').read()).decode())
")
curl -s -X POST "$B/api/attach" -H 'Content-Type: application/json' -d "{\"plan_id\": \"$PLAN_ID\", \"doc_type\": \"waybill\", \"image_base64\": \"$IMG2\"}" | python3 -c "import json,sys; d=json.load(sys.stdin); print('complete:', d['plan']['complete'], '| missing:', d['plan']['missing'])"

echo "--- 5.1 OCR 装车磅单并自动填入 ---"
IMG3=$(python3 -c "
import base64
print(base64.b64encode(open('$D/images/load.png','rb').read()).decode())
")
OCR3=$(curl -s -X POST "$B/api/ocr" -H 'Content-Type: application/json' -d "{\"image_base64\": \"$IMG3\"}")
print -r -- "$OCR3" | python3 -c "import json,sys; d=json.load(sys.stdin); print('type:', d['parsed']['doc_type'], '| truck:', d['parsed']['truck_no'], '| date:', d['parsed']['load_date'], '| candidates:', len(d['candidates']))"
curl -s -X POST "$B/api/attach" -H 'Content-Type: application/json' -d "{\"plan_id\": \"$PLAN_ID\", \"doc_type\": \"load\", \"image_base64\": \"$IMG3\"}" | python3 -c "import json,sys; d=json.load(sys.stdin); print('complete:', d['plan']['complete'], '| missing:', d['plan']['missing'])"

echo "--- 5.2 修改计划（模拟前端整表单保存） ---"
curl -s -X PUT "$B/api/plans/$PLAN_ID" -H 'Content-Type: application/json' -d '{
  "load_date": "2026-08-12",
  "truck_no": "冀J0B318",
  "gas_source": "正安",
  "supplier": "浙江禾兴",
  "station": "宜章西东站",
  "plan_arrive": "2026-08-13T19:00",
  "price": 5900,
  "net_weight": 31.22,
  "note": "测试修改备注"
}' | python3 -c "import json,sys; d=json.load(sys.stdin); print('note:', d['plan']['note'], '| amount:', d['plan']['amount'], '| waybill kept:', bool(d['plan']['images']['waybill']))"

echo "--- 6. 当日统计 ---"
curl -s "$B/api/stats?mode=day&date=2026-08-12" | python3 -c "import json,sys; d=json.load(sys.stdin)['stats']; print('total:', d['total'], '| complete:', d['complete'], '| missing:', (d['missing_load'], d['missing_unload'], d['missing_waybill']), '| amount:', d['amount'])"

echo "--- 7. 导出 Excel ---"
curl -s -o /tmp/export_test.xlsx "$B/api/export?from=2026-08-12&to=2026-08-12"
ls -la /tmp/export_test.xlsx
python3 -c "
from openpyxl import load_workbook
wb = load_workbook('/tmp/export_test.xlsx')
ws = wb['对账清单']
print('sheets:', wb.sheetnames)
print('rows:', ws.max_row, 'cols:', ws.max_column)
print('header:', [c.value for c in ws[1]])
for r in ws.iter_rows(min_row=2, max_row=min(ws.max_row, 3), values_only=True):
    print('row:', r[:7])
print('images in 对账清单:', len(ws._images))
ws2 = wb['每日汇总']
print('汇总:', [[c.value for c in row] for row in ws2.iter_rows(min_row=1, max_row=min(ws2.max_row, 3))])
"
