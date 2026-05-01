const express = require("express");
const app = express();
app.use(express.json());

const MONDAY_API_KEY = process.env.MONDAY_API_KEY;

const CLIENTS_BOARD_ID = "18391352531";
const NEGOTIATIONS_BOARD_ID = "18391352712";
const CLIENTS_RELATION_COL = "board_relation_mm2ykwq3";
const CLIENTS_EMAIL_COL = "email_mkzn9q7n";
const NEGOTIATIONS_RELATION_COL = "board_relation_mm2yqw4f";
const NEGOTIATIONS_EMAIL_COL = "email_mkyf3b46";
const INSURANCE_EMAIL_COL = "email_mm2yqfsx";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function mondayQuery(query) {
  const response = await fetch("https://api.monday.com/v2", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: MONDAY_API_KEY,
      "API-Version": "2024-01",
    },
    body: JSON.stringify({ query }),
  });
  return response.json();
}

async function getConnectedInsuranceId(itemId, relationColId) {
  const query = `{
    items(ids: [${itemId}]) {
      column_values(ids: ["${relationColId}"]) {
        value
        ... on BoardRelationValue {
          linked_item_ids
        }
      }
    }
  }`;
  const result = await mondayQuery(query);
  console.log("Relation result:", JSON.stringify(result));

  const colVal = result?.data?.items?.[0]?.column_values?.[0];
  if (!colVal) return null;

  if (colVal.linked_item_ids && colVal.linked_item_ids.length > 0) {
    return String(colVal.linked_item_ids[0]);
  }

  if (colVal.value) {
    try {
      const parsed = JSON.parse(colVal.value);
      const linkedIds = parsed.linkedPulseIds || [];
      if (linkedIds.length > 0) {
        return String(linkedIds[0].linkedPulseId || linkedIds[0]);
      }
    } catch(e) {
      console.log("Parse error:", e.message);
    }
  }

  return null;
}

async function getInsuranceEmail(insuranceItemId) {
  const query = `{
    items(ids: [${insuranceItemId}]) {
      name
      column_values(ids: ["${INSURANCE_EMAIL_COL}"]) {
        value
        text
      }
    }
  }`;
  const result = await mondayQuery(query);
  console.log("Insurance result:", JSON.stringify(result));
  const colVal = result?.data?.items?.[0]?.column_values?.[0];
  if (!colVal || !colVal.value) return null;
  try {
    const parsed = JSON.parse(colVal.value);
    return parsed.email || null;
  } catch {
    return colVal.text || null;
  }
}

async function updateInsuranceEmail(itemId, boardId, emailColId, email) {
  const value = JSON.stringify({ email: email, text: email });
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const query = `mutation {
    change_column_value(
      board_id: ${boardId},
      item_id: ${itemId},
      column_id: "${emailColId}",
      value: "${escaped}"
    ) {
      id
    }
  }`;
  const result = await mondayQuery(query);
  console.log("Update result:", JSON.stringify(result));
  return result;
}

app.post("/webhook", async (req, res) => {
  try {
    if (req.body?.challenge) {
      return res.json({ challenge: req.body.challenge });
    }

    const event = req.body?.event;
    if (!event) return res.status(400).json({ error: "No event found" });

    const { pulseId, boardId, columnId } = event;
    console.log(`Event: item ${pulseId}, board ${boardId}, column ${columnId}`);

    let relationColId, emailColId;

    if (String(boardId) === CLIENTS_BOARD_ID && columnId === CLIENTS_RELATION_COL) {
      relationColId = CLIENTS_RELATION_COL;
      emailColId = CLIENTS_EMAIL_COL;
    } else if (String(boardId) === NEGOTIATIONS_BOARD_ID && columnId === NEGOTIATIONS_RELATION_COL) {
      relationColId = NEGOTIATIONS_RELATION_COL;
      emailColId = NEGOTIATIONS_EMAIL_COL;
    } else {
      return res.json({ status: "ignored" });
    }

    // Wait 3 seconds for monday.com to save the value
    console.log("Waiting 3 seconds for monday.com to save...");
    await sleep(3000);

    const insuranceId = await getConnectedInsuranceId(pulseId, relationColId);
    console.log("Insurance ID:", insuranceId);
    if (!insuranceId) {
      return res.json({ status: "no insurance company connected" });
    }

    const email = await getInsuranceEmail(insuranceId);
    console.log("Email:", email);
    if (!email) {
      return res.json({ status: "no email found" });
    }

    await updateInsuranceEmail(pulseId, boardId, emailColId, email);
    console.log(`✅ Item ${pulseId} -> ${email}`);
    return res.json({ status: "success", email });

  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ error: err.message });
  }
});

app.get("/", (req, res) => {
  res.json({ status: "✅ Monday Insurance Webhook running!" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Running on port ${PORT}`));
