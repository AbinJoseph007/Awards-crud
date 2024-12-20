const cron = require('node-cron');
const Airtable = require('airtable');
const express = require('express');
const cors = require("cors");
const axios = require('axios');
require('dotenv').config();



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
  
  function normalizeUrl(url) {
    if (!url) return '';
    try {
      let normalizedUrl = url.trim();
  
      // Remove query parameters (everything after '?')
      normalizedUrl = normalizedUrl.split('?')[0];
  
      // Remove trailing slash if present
      if (normalizedUrl.endsWith('/')) {
        normalizedUrl = normalizedUrl.slice(0, -1);
      }
  
      return normalizedUrl;
    } catch (error) {
      console.error('Error normalizing URL:', error);
      return url;
    }
  }
  
  function sanitizeField(value) {
    // If value is an object with a URL, normalize and trim the URL
    if (value && typeof value === 'object' && value.url) {
      const sanitizedUrl = normalizeUrl(value.url); // Normalize the URL before returning
      console.log('Sanitized Image URL:', sanitizedUrl);
      return sanitizedUrl;
    }
    // If it's a string, just trim and return it
    return typeof value === 'string' ? value.trim() : '';
  }
  
  function hasDifferences(airtableFields, webflowFields) {
    const nameDiff = sanitizeField(airtableFields.name) !== sanitizeField(webflowFields.name);
    const yearDiff = sanitizeField(airtableFields.year) !== sanitizeField(webflowFields.year);
    
    // Normalize and compare image URLs
    const airtableImage = sanitizeField(airtableFields['award-winner-image']);
    const webflowImage = sanitizeField(webflowFields['award-winner-image']);
    const imageDiff = airtableImage !== webflowImage;
    
    console.log('Comparing Airtable Image URL:', airtableImage);
    console.log('Comparing Webflow Image URL:', webflowImage);
    console.log('Image Difference:', imageDiff);
  
    console.log('Comparing Airtable Fields:', airtableFields);
    console.log('Comparing Webflow Fields:', webflowFields);
    console.log('Differences:', { nameDiff, yearDiff, imageDiff });
    
    return nameDiff || yearDiff || imageDiff;
  }
  
  
 
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
        if (hasDifferences(airtableFields, existingWebflowItem.fieldData)) {
            console.log(`Updating Webflow item with airtableid ${airtableFields.airtableid}`);
            await updateWebflowItem(webflowCollectionId, existingWebflowItem.id, airtableFields);
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
  

  // Update Webflow item 
  async function updateWebflowItem(collectionId, webflowId, fieldsToUpdate) {
    const url = `https://api.webflow.com/v2/collections/${webflowCollectionId}/items/${webflowId}`;
    console.log('Updating Webflow item with ID:', webflowId);
  
    try {
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${webflowApiKey}`,
          'Content-Type': 'application/json',
          'Origin': 'https://biaw-stage-3d0019b2f20edef3124873f20de2.webflow.io/classes',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({
          fieldData: {
            name: fieldsToUpdate.name || '',
            year: fieldsToUpdate.year || '',
            slug: fieldsToUpdate.name ? fieldsToUpdate.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') : '',
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
      console.error('Error while updating data in Webflow:', error);
      return null;
    }
  }
  
  // Delete a Webflow item
  async function deleteWebflowItem(webflowId) {
    const url = `https://api.webflow.com/v2/collections/${webflowCollectionId}/items/${webflowId}`;
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
      console.error('Error deleting item from Webflow:', error);
      return null;
    }
  }
  
  // Add a new item to Webflow
  async function addWebflowItem(airtableFields) {
    const url = `https://api.webflow.com/v2/collections/${webflowCollectionId}/items`;
    console.log('Adding new Webflow item:', airtableFields);
  
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${webflowApiKey}`,
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({
          fieldData: {
            name: airtableFields.name || '',
            year: airtableFields.year || '',
            slug: airtableFields.name ? airtableFields.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') : '',
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
      console.error('Error while adding data to Webflow:', error);
      return null;
    }
  }
  
  syncAirtableToWebflow();

  cron.schedule('*/30 * * * * *', async () => {
    console.log('Starting the sync process...');
    await syncAirtableToWebflow();
    console.log('Sync process completed.');
  });
  
  const SITE_ID = "670d37b3620fd9656047ce2d"; 
  const API_BASE_URL = "https://api.webflow.com/v2";
  
  // Publish staged items of purchases
  async function publishStagedItems() {
    try {
      // Fetch all collections for the site
      const collectionsResponse = await axios.get(`${API_BASE_URL}/sites/${SITE_ID}/collections`, {
        headers: {
          Authorization: `Bearer ${webflowApiKey}`,
          "Accept-Version": "1.0.0",
        },
      });
  
      const collections = collectionsResponse.data.collections || [];
      if (!collections.length) {
        console.log("No collections found.");
        return;
      }
  
      console.log(
        "Available Collections:",
        collections.map((col) => ({
          id: col.id,
          name: col.displayName,
          slug: col.slug,
        }))
      );
  
      const targetCollection = collections.find(
        (collection) => collection.displayName === "Lifetime Achievement Award Winners"
      );
  
      if (!targetCollection) {
        console.log("Target collection not found. Ensure the collection name matches exactly.");
        return;
      }
  
      const COLLECTION_ID = targetCollection.id;
      console.log(`Using Collection ID: ${COLLECTION_ID}`);
  
      // Fetch items in the collection
      const itemsResponse = await axios.get(`${API_BASE_URL}/collections/${COLLECTION_ID}/items`, {
        headers: {
          Authorization: `Bearer ${webflowApiKey}`,
          "Accept-Version": "1.0.0",
        },
      });
  
      const items = itemsResponse.data.items || [];
  
      // Filter out items where 'lastPublished' is null or if they have been updated since last publication
      const stagedItemIds = items
        .filter((item) => {
          // If the item has not been published yet or has been updated since its last publish
          return item.lastPublished === null || new Date(item.lastUpdated) > new Date(item.lastPublished);
        })
        .map((item) => item.id);
  
      if (!stagedItemIds.length) {
        console.log("No items to publish.");
        return;
      }
  
      console.log(`Items ready for publishing: ${stagedItemIds}`);
  
      // Publish the items
      const publishResponse = await axios.post(
        `${API_BASE_URL}/collections/${COLLECTION_ID}/items/publish`,
        { itemIds: stagedItemIds },
        {
          headers: {
            Authorization: `Bearer ${webflowApiKey}`,
            "Content-Type": "application/json",
          },
        }
      );
  
      console.log("Publish Response:", publishResponse.data);
    } catch (error) {
      console.error("Error publishing staged items:", error.response?.data || error.message);
    }
  }
  
  publishStagedItems();
  
  
  async function runPeriodicallys(intervalMs) {
    console.log("Starting periodic sync...");
    setInterval(async () => {
      console.log(`Running sync at ${new Date().toISOString()}`);
      await publishStagedItems(); 
    }, intervalMs);
  }
  
  runPeriodicallys(15 * 1000); 
  
const PORT = process.env.PORT || 6000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
