## 项目背景与目标

### 背景
- 此前 SIDL（社交身份层）历史数据初始化到 CIM 时，仅处理了约 **40 万**可与现有账号合并的 SIDL 账号，剩余 **120 万** social prospect 账号未同步到任何下游系统（图中 #1 部分）。
- 当时未同步的原因是这些 social prospect 尚无明确使用场景。
- 现在 CDP UC3 需要触达这部分 social prospect，但目前只能从 SIDL 手动筛选。为实现 UC3 人群圈选自动化（通过 QA 圈选后直接进入自动流），需要将这部分 social prospect 导入 QA。
### 讨论结论
- **仅导入 QA**：`#1` 账号只导入 QA，暂不同步至 SFOA 及报表。
- **新增标签 `sidl_not_init_cn`**：CDP 为这批账号打上该标签，取值为 `TRUE`；其他正常 GCID 为空。
- **数据字段约定**：对于 #1 账号，Segment、Friendly ID、Main SA/BTQ、销售相关标签均为空；`gc_id` 与 `union_id` 正常赋值；基本信息标签（birthday、gender 等）正常赋值；线上行为和算法相关标签正常赋值。
- **新增标签 `social_prospect_cn`**：取值为 `TRUE`，标记仅在社交渠道（SIDL 包含的渠道）注册的账号（即图中 #1 + #2 + #3）。非 social prospect 为空。

### 当前需要做的事
1. 完成 SIDL 初始化（将剩余 120 万 social prospect 按规则写入 CIM）。
2. CDP 中新增两个标签：`sidl_not_init_cn` 和 `social_prospect_cn`。

---
## 影响分析

```mermaid
flowchart LR
    Init["🚀 Social ID Layer Account 初始化<br/>(MDM → CDP)"] 
    
    Init --> Reports["📊 报表系统<br/>━━━━━━━━━━━━━━━━━━━━<br/>• CRM REPORT ✅ 无影响<br/>• EC REPORT ✅ 无影响<br/>• DOD REPORT ✅ 无影响<br/>━━━━━━━━━━━━━━━━━━━━<br/>原因：报表仅基于有订单客户分析"]
    Init --> SFOA["🔒 SFOA<br/>━━━━━━━━━━━━━━━━━━━━<br/>✅ 无影响<br/>━━━━━━━━━━━━━━━━━━━━<br/>原因：FILTERED逻辑会排除<br/>不在SFOA中的客户数据"]
    Init --> MainSA["🛍️ MAIN SA / BOUTIQUE<br/>━━━━━━━━━━━━━━━━━━━━<br/>✅ 无影响<br/>━━━━━━━━━━━━━━━━━━━━<br/>原因：待初始化数据中<br/>STORE_CREATION / SA_CREATION<br/>字段均为空"]
    Init --> QA["🔍 QA<br/>━━━━━━━━━━━━━━━━━━━━<br/>✨ 正面影响<br/>━━━━━━━━━━━━━━━━━━━━<br/>• 数据行数无变化<br/>• 标签值：空 → 具体值<br/>• 标签数据更丰富<br/>（符合期望结果）"]
    Init --> Local["📈 Local Analytic<br/>━━━━━━━━━━━━━━━━━━━━<br/>📊 数据量变化<br/>━━━━━━━━━━━━━━━━━━━━<br/>• account_mapping 表 ↑ 增多<br/>• client 表 ↑ 增多<br/>（初始化带来更完整的映射与客户记录）<br/> 需调整"]

    classDef noImpact fill:#E8F5E9,stroke:#2E7D32,stroke-width:2px,color:#1B5E20,font-weight:bold;
    classDef positive fill:#E3F2FD,stroke:#1565C0,stroke-width:2px,color:#0D47A1,font-weight:bold;
    classDef growth fill:#FFF3E0,stroke:#E65100,stroke-width:2px,color:#BF360C,font-weight:bold;
    classDef initClass fill:#F3E5F5,stroke:#6A1B9A,stroke-width:2px,color:#4A148C,font-weight:bold;
    
    class Reports,SFOA,MainSA noImpact;
    class QA positive;
    class Local growth;
    class Init initClass;
```
![[Pasted image 20260512113343.png]]

- 关于Segment/segment_history：新增的客户信息，值为NO_SEGMENT
- 关于KPI: 所有KPI都是基于销售订单，因此，输出kpi的所有字段都为空
- 给到DSL 身份数据量增加
- 给到magento身份数据量增加
- 以下给到datamart的数据表数据量增加（不处理）：
	- ads_edp_client_computed_indicator_fact_v1_df
	- ads_dim_cust_cust_ww_ext_df
	- ads_dws_cust_tag_ww_df
	- ads_cust_segment_month_df
	- ads_dim_cust_cdpid_idmapping_output_df

ads_dim_cust_cust_ext_df
---
## 执行方案说明

### 一、完成 SIDL 历史数据初始化

#### 步骤
1. **确定初始化客户清单**  
   比对 CDP `ods_sidl_customer_df` 表与 CIM ACCOUNT 表，找出在 SIDL 中存在但在 CIM ACCOUNT 中不存在的客户。

2. **MDM 数据探查**
   在 MDM 中筛选这部分人群，确认可覆盖客户量及未被覆盖客户量（应为 0 或少量）。

3. **组装数据**  
   - 按 CIM 的表结构组装待写入数据。
   - 使用gold数据

5. **数据写入（分两类）**  
   - **CIM 中有对应 GCID，但缺失 SIDL ACCOUNT**：按对应 CIM event date，仅写入 SIDL Account。或者由MDM重新推送。 
   - **CIM 中缺失 GCID**：
	   - 方案一：写入全套 CIM 数据（包括 Account 及其他必要字段）。
	   - 方案二：手动调整MDM常规写入CDP consumer表中的is_delta字段值，将这部分客档is_delta置为1，手动调度下游实例，写入CDP

5. **数据检查**  
   完成初始化后验证数据一致性。

#### 流程图

```mermaid
flowchart TD
    A[开始：SIDL历史数据初始化] --> B[确定初始化客户清单<br>比对 ODS SIDL 与 CIM ACCOUNT<br>**1,054,040**]
    B --> C[MDM数据探查<br>筛选目标人群，确认覆盖量<br>**1,053,877**,未匹配到：**163** ]
    C --> D[按CIM表结构组装数据]
    D --> E{判断CIM中是否存在GCID?}
    E -->|存在GCID但缺失SIDL Account<br>**247**<br>有62个MDM历史未推送过| F[**MDM重推这部分gcid**]
    E -->|缺失GCID<br>**1,053,630**| G[写入全套CIM数据]
    F --> H[数据检查]
    G --> H
    H --> I[初始化完成]
```
![[Pasted image 20260512113431.png]]

### 二、CDP 中新增两个标签

#### 1. 标签 `sidl_not_init_cn`
- **含义**：标记 SIDL 是否未被 MDM 输出过（正常链路输出至 COR CN）。本次初始化的数据不在输出范围内。
- **取值**：`True` 或空。
- **生成逻辑**：
  1. MDM 生成历史输出 GCID 状态表。
  2. CDP ODS 层接收该数据表。
  3. 基于该表判断：未被 MDM 输出过、但有 SIDL account 的 GCID，将其标签置为 `True`。

#### 2. 标签 `social_prospect_cn`
- **含义**：标记是否仅有 SIDL account（即仅在社交渠道注册，包括 `#1` `#2` `#3`）。
- **取值**：`True` 或空。
- **生成逻辑**：
  - 根据 CIM account 表判断：如果某个 GCID 仅有 SIDL account（无其他渠道账号），则置为 `True`。

#### 流程图

```mermaid
flowchart TD
    subgraph 标签1: sidl_not_init_cn
        A1[MDM生成历史输出GCID状态表] --> B1[CDP ODS层接收该表]
        B1 --> C1[判断: 未被MDM输出过<br>且有SIDL account?]
        C1 -->|是| D1[标签置为 TRUE]
        C1 -->|否| E1[标签保持为空]
    end
```
```mermaid
flowchart TD
subgraph 标签2: social_prospect_cn
        A2[读取CIM account表] --> B2[判断: 是否仅有SIDL account<br>（无其他渠道账号）?]
        B2 -->|是| C2[标签置为 TRUE]
        B2 -->|否| D2[标签保持为空]
    end
```




