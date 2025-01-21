const cron = require('node-cron');
const Airtable = require('airtable');
const express = require('express');
const cors = require("cors");
const axios = require('axios');
require('dotenv').config();
const crypto = require('crypto');



const app = express();
app.use(express.json());

const allowedOrigins = [
  "https://biaw-stage-api.webflow.io",
];
app.use(
  cors({
    origin: allowedOrigins,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.get("/", (req, res) => {
  res.send("Server is running and ready to accept requests.");
});

const airtableBaseId = process.env.airtableBaseId
const airtableClassTableName = process.env.airtableClassTableName
const airtableApiKey = process.env.airtableApiKey
const webflowApiKey = process.env.webflowApiKey
const webflowCollectionId = process.env.webflowCollectionId

async function getAirtableClassRecords() {
    const url = `https://api.airtable.com/v0/${airtableBaseId}/${airtableClassTableName}`;
    console.log('Fetching Class records from:', url);
  
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${airtableApiKey}`,
      },
    });
  
    if (!response.ok) {
      console.error('Failed to fetch Class records:', response.status, response.statusText);
      return [];
    }
  
    const data = await response.json();
    console.log('Received Class records:', data.records);
    return data.records;
  }  
  
  async function getWebflowRecords() {
    const url = `https://api.webflow.com/v2/collections/${webflowCollectionId}/items`;
    console.log('Fetching Webflow records from:', url);
  
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${webflowApiKey}`,
        'accept-version': '1.0.0',
      },
    });
  
    if (!response.ok) {
      console.error('Failed to fetch Webflow records:', response.status, response.statusText);
      return [];
    }
  
    const data = await response.json();
    console.log('Received Webflow records:', data.items);
    return data.items;
  }
 // Normalize URLs
function normalizeUrl(url) {
  if (!url) return '';
  try {
    let normalizedUrl = url.trim();
    normalizedUrl = normalizedUrl.split('?')[0]; // Remove query parameters
    if (normalizedUrl.endsWith('/')) {
      normalizedUrl = normalizedUrl.slice(0, -1); // Remove trailing slash
    }
    return normalizedUrl;
  } catch (error) {
    console.error('Error normalizing URL:', error);
    return url;
  }
}

// Sanitize Field Values
function sanitizeField(value) {
  if (value && typeof value === 'object' && value.url) {
    return normalizeUrl(value.url);
  }
  return typeof value === 'string' ? value.trim() : '';
}

// Generate Hash for Image Content
async function getImageHash(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Failed to fetch image from ${url}:`, response.statusText);
      return null;
    }
    const buffer = await response.arrayBuffer();
    const hash = crypto.createHash('md5').update(Buffer.from(buffer)).digest('hex');
    return hash;
  } catch (error) {
    console.error(`Error fetching or hashing image: ${error.message}`);
    return null;
  }
}

// Compare Airtable and Webflow Records
async function hasDifferences(airtableFields, webflowFields) {
  const nameDiff = sanitizeField(airtableFields.name) !== sanitizeField(webflowFields.name);
  const yearDiff = sanitizeField(airtableFields.year) !== sanitizeField(webflowFields.year);

  const airtableImageUrl = sanitizeField(airtableFields['award-winner-image']);
  const webflowImageUrl = sanitizeField(webflowFields['award-winner-image']);
  let imageDiff = false;

  if (airtableImageUrl || webflowImageUrl) {
    const airtableHash = airtableImageUrl ? await getImageHash(airtableImageUrl) : null;
    const webflowHash = webflowImageUrl ? await getImageHash(webflowImageUrl) : null;
    imageDiff = airtableHash !== webflowHash;
  }

  // console.log('Comparing Airtable Fields:', airtableFields);
  // console.log('Comparing Webflow Fields:', webflowFields);
  console.log('Differences:', { nameDiff, yearDiff, imageDiff });

  return nameDiff || yearDiff || imageDiff;
}

// Sync Airtable to Webflow
async function syncAirtableToWebflow() {
  const classRecords = await getAirtableClassRecords();
  const webflowRecords = await getWebflowRecords();

  const webflowItemMap = webflowRecords.reduce((map, item) => {
    if (item && item.fieldData && item.fieldData.airtableid) {
      map[item.fieldData.airtableid] = item;
    }
    return map;
  }, {});

  console.log('Webflow Item Map:', webflowItemMap);

  const airtableRecordIds = new Set(classRecords.map(record => record.id));

  for (const airtableRecord of classRecords) {
    const airtableFields = {
      name: airtableRecord.fields.Name || '',
      slug: airtableRecord.fields.Name
        ? airtableRecord.fields.Name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
        : '',
      year: airtableRecord.fields.Year || '',
      'award-winner-image': airtableRecord.fields['Award winner image']?.[0]?.url || '',
      airtableid: airtableRecord.id,
    };

    const existingWebflowItem = webflowItemMap[airtableFields.airtableid];

    if (existingWebflowItem) {
      if (await hasDifferences(airtableFields, existingWebflowItem.fieldData)) {
        console.log(`Updating Webflow item with airtableid ${airtableFields.airtableid}`);
        await updateWebflowItem(existingWebflowItem.id, airtableFields);
      } else {
        console.log(`No changes for Webflow item with airtableid ${airtableFields.airtableid}. Skipping update.`);
      }
    } else {
      console.log('Adding new record to Webflow:', airtableFields.name);
      await addWebflowItem(airtableFields);
    }
  }

  for (const webflowItem of webflowRecords) {
    const airtableid = webflowItem.fieldData?.airtableid;
    if (airtableid && !airtableRecordIds.has(airtableid)) {
      console.log(`Deleting Webflow item with ID ${webflowItem.id} as it no longer exists in Airtable.`);
      await deleteWebflowItem(webflowItem.id);
    }
  }
}

// Update Webflow Item
async function updateWebflowItem(webflowId, fieldsToUpdate) {
  const url = `https://api.webflow.com/v2/collections/${webflowCollectionId}/items/${webflowId}/live`;
  console.log('Updating Webflow item with ID:', webflowId);

  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${webflowApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fieldData: {
          name: fieldsToUpdate.name || '',
          year: fieldsToUpdate.year || '',
          slug: fieldsToUpdate.slug || '',
          airtableid: fieldsToUpdate.airtableid || '',
          'award-winner-image': fieldsToUpdate['award-winner-image'] || '',
          _archived: false,
          _draft: false,
        },
      }),
    });

    if (!response.ok) {
      console.error('Failed to update Webflow item:', await response.json());
      return null;
    }

    const data = await response.json();
    console.log('Webflow item updated:', data);
    return data;
  } catch (error) {
    console.error('Error updating Webflow item:', error);
    return null;
  }
}

// Delete Webflow Item
async function deleteWebflowItem(webflowId) {
  const url = `https://api.webflow.com/v2/collections/${webflowCollectionId}/items/${webflowId}/live`;
  console.log('Deleting Webflow item with ID:', webflowId);

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${webflowApiKey}`,
      },
    });

    if (!response.ok) {
      console.error('Failed to delete Webflow item:', await response.json());
      return null;
    }

    console.log('Webflow item deleted:', webflowId);
    return true;
  } catch (error) {
    console.error('Error deleting Webflow item:', error);
    return null;
  }
}

// Add New Webflow Item
async function addWebflowItem(airtableFields) {
  const url = `https://api.webflow.com/v2/collections/${webflowCollectionId}/items/live`;
  console.log('Adding new Webflow item:', airtableFields);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${webflowApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fieldData: {
          name: airtableFields.name || '',
          year: airtableFields.year || '',
          slug: airtableFields.slug || '',
          airtableid: airtableFields.airtableid || '',
          'award-winner-image': airtableFields['award-winner-image'] || '',
          _archived: false,
          _draft: false,
        },
      }),
    });

    if (!response.ok) {
      console.error('Failed to add Webflow item:', await response.json());
      return null;
    }

    const data = await response.json();
    console.log('New Webflow item added:', data);
    return data;
  } catch (error) {
    console.error('Error adding Webflow item:', error);
    return null;
  }
}

// Run the Sync Process
syncAirtableToWebflow();


  cron.schedule('*/30 * * * * *', async () => {
    console.log('Starting the sync process...');
    await syncAirtableToWebflow();
    console.log('Sync process completed.');
  });
  

  const PORT = process.env.PORT || 6000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});