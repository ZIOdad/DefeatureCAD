# Product

## Definition

생산도면용 3D CAD를 CFD 해석에 적합한 simplified CAD로 다시 그려, CFD 엔지니어가 전처리에 쓰는 시간을 줄이고 해석 자체에 집중하게 하는 서비스다.

## Users and situations

개발팀으로부터 해석을 의뢰받은 CFD 엔지니어가, 생산도면을 위해 작성된 3D CAD(부품 하나)로 해석을 준비하는 상황에서 쓴다.

## Problem and current alternatives

생산도면용 CAD에는 Round, chamfer, 단차, small edge, small face, 간격이 매우 좁은(2mm 이하) face처럼 격자 품질에 불필요한 요소가 들어 있다. 엔지니어는 SpaceClaim의 Delete 같은 CAD SW 기능으로 이를 제거하지만, 주변 면과 수학적으로 연결되지 않는 Round나 미소 단차는 제거되지 않는 일이 잦고 해결이 아예 안 되기도 한다. 그러면 격자 생성 툴에서 낮은 품질의 격자를 직접 수정해야 하고, 그만큼 해석이 지연된다.

## Promised change

전처리에 드는 시간이 크게 줄고, 엔지니어는 그 시간을 해석 문제 정의와 물리적 고찰에 써서 해석의 질을 높인다.

## Core loop

1. 엔지니어가 원본 CAD를 서비스에 건넨다.
2. 서비스가 제거할 요소를 먼저 제안하고, 원본 CAD를 보여 주며 남겨야 하는 부분을 표시해 달라고 묻는다.
3. 엔지니어가 CAD 화면에서 남길 부분을 표시하고 제안을 확인한다.
4. 서비스가 확인된 내용대로 해석용 CAD를 다시 그려 돌려준다.

## Capabilities and boundaries

- 입력과 출력은 Parasolid(.x_t) 형식이며, 한 번에 부품 하나만 다룬다.
- 어떤 형상이 단순화해도 되는지는 상황마다 달라서, 서비스는 제안만 하고 사용자가 확인하기 전에는 단순화하지 않는다.
- "작은" 요소의 기준은 기본값 2mm이며, 사용자가 원하는 값으로 바꿀 수 있다.
- 결과물은 원본과의 유사도를 부피 IoU(교집합 ÷ 합집합) 90% 이상으로 유지해야 한다. 최대 편차와 표면적 변화율은 판정에 쓰지 않고 보고용으로만 보여 준다.
- 결과물에는 Repair 요소가 없어야 한다. Repair 요소 없음은 SpaceClaim Repair의 검사 항목(Missing Faces, Gaps, Split Edges, Extra Edges, Small Faces, Inexact Edges)이 모두 0건이고 결과가 닫힌 solid인 상태를 뜻한다.
- 격자 생성과 CFD 해석 자체는 이 서비스의 범위가 아니다.

## Experience principles

- 제거 여부의 최종 판단은 사용자가 한다. 서비스는 근거와 함께 제안하고, 확인 없이 형상을 바꾸지 않는다.
- 원본에서 무엇이 어떻게 바뀌었는지 사용자가 판정 근거(유사도, Repair 검사 결과)와 함께 확인할 수 있어야 한다.

## Success signals

- 의뢰 한 건의 전처리 시간이 현재보다 눈에 띄게 줄고, 격자 생성 툴에서 품질 낮은 격자를 직접 수정하는 작업이 줄어든다.
- 돌려받은 CAD가 부피 IoU 90% 이상이고 Repair 검사 항목이 모두 0건이라, 바로 격자 생성에 쓸 수 있다.
- 엔지니어가 확보한 시간을 해석 문제 정의와 물리적 고찰에 쓴다.

## Assumptions and unknowns

- Assumption: 부피 IoU 90%가 형상 충실도의 충분한 척도다. 얇거나 작은 형상은 부피에 거의 기여하지 않아 이 값이 둔감할 수 있다.
- Unknown: 유사도와 Repair 기준을 만족하는 결과가 실제 CFD 해석 결과에 미치는 영향은 아직 확인되지 않았다.
