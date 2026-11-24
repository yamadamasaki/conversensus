# propertyName のテスト仕様

## 何を

template が配る property の、適用先での名前 (template-update K7、計画 T6)。template graph に prefix 無しで書いた
名前 (`期限`) を、適用先では template の名前空間に入れる (`${templateId}.期限`)。その逆 (種の複製で使う) と、
人が読める形 (template の名前 + 書いた名前)。

## なぜ

prefix が無いと、2 つの template が同じ名前を配ったときや、利用者が同じ名前の custom を付けたときに衝突する。
読み替え (`templateFromSheet`) と種の複製 (`templateGraphOf`) が互いの逆になっていないと、種を複製するたびに
名前が `template.<id>.template.<id>.期限` のように伸びる。

## どのように

### 生成器

名前の小さなプール: prefix の無い名前 (日本語・空白を含むもの)・拡張の名前・system の名前・使えない名前 (`kind`)。

### 性質

| 性質 | 固定すること |
| --- | --- |
| 書く名前 → 適用先の名前 → 書く名前 で戻る | 種の複製と読み替えが互いの逆 |
| 名前空間を持つ名前 (`.` を含む) はそのまま、持たない名前は template の名前空間に入る | system・拡張の名前を template のものにしない |
| 別の template の名前空間の名前は、書く名前に戻さない | 別の template の property を自分のものとして複製しない |

### 例

- `kind` は使えない — `${templateId}.kind` は種別 property の名前である
- 人が読める形には、template の名前と書いた名前を出す。種別 property・知らない template のもの・custom は含めない
