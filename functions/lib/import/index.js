'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
/*
 * Copyright 2021 Algolia
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const admin = require("firebase-admin");
const config_1 = require("../config");
const extract_1 = require("../extract");
const index_1 = require("../index");
const logs = require("../logs");
const util_1 = require("../util");
// initialize the application using the Google Credentials in the GOOGLE_APPLICATION_CREDENTIALS environment variable.
admin.initializeApp({
    credential: admin.credential.applicationDefault(),
});
const database = admin.firestore();
const sentDataToAlgolia = (data) => {
    // Add or update new objects
    logs.info(`Preparing to send ${data.length} record(s) to Algolia.`);
    index_1.index
        .partialUpdateObjects(data, { createIfNotExists: true })
        .then(() => {
        logs.info('Document(s) imported into Algolia');
        process.exit(1);
    })
        .catch(error => {
        logs.error(error);
    });
};
const BATCH_MAX_SIZE = 9437184;
const processQuery = async (querySnapshot) => {
    let records = [];
    const docs = querySnapshot.docs;
    const timestamp = Date.now();
    for (const doc of docs) {
        // Skip over any docs pulled in from collectionGroup query that dont match config
        if (!doesPathMatchConfigCollectionPath(doc.ref.path)) {
            continue;
        }
        try {
            const payload = await (0, extract_1.default)(doc, timestamp);
            records.push(payload);
        }
        catch (e) {
            logs.warn('Payload size too big, skipping ...', e);
        }
        // We are sending batch updates to Algolia.  We need this to be less than 9 MB (9437184)
        const size = (0, util_1.getObjectSizeInBytes)(records);
        if (size >= BATCH_MAX_SIZE) {
            logs.info('Sending bulk Records to Algolia');
            sentDataToAlgolia(records);
            // reset records after sending
            records = [];
        }
    }
    // Send rest of the records that are still in the records array
    if (records.length > 0) {
        logs.info('Sending rest of the Records to Algolia');
        sentDataToAlgolia(records);
    }
};

const retrieveChunk = async (lastVisible, maxLength) => {
    const collectionPathParts = config_1.default.collectionPath.split('/');
    const collectionPath = collectionPathParts[collectionPathParts.length - 1];
    let querySnapshot;

    if (lastVisible) {
        querySnapshot = await database.collection(collectionPath).limit(maxLength).startAfter(lastVisible).get();
    }
    else {
        querySnapshot = await database.collection(collectionPath).limit(maxLength).get();
    }

    processQuery(querySnapshot).catch(console.error);
    
    return [querySnapshot.docs[querySnapshot.docs.length - 1], querySnapshot.docs.length];
};

const retrieveDataFromFirestore = async (lastVisible=null) => {
    const maxLength = 100;
    const [keepGoing, length] = await retrieveChunk(lastVisible, maxLength);
    console.log("LENGTH", length);
    if (length == maxLength) retrieveDataFromFirestore(keepGoing);
};

const doesPathMatchConfigCollectionPath = (path) => {
    const pathSegments = path.split('/');
    const collectionPathSegments = config_1.default.collectionPath.split('/');
    return collectionPathSegments.every((configSegment, i) => {
        // check if the configured path segment matches the path segment retrieved from firebase
        // if configured path has a placeholder pattern for document id, return true
        return configSegment.match(/{.*?}/) !== null || configSegment === pathSegments[i];
    });
};

retrieveDataFromFirestore()
    .catch(error => {
    logs.error(error);
    process.exit(1);
});
