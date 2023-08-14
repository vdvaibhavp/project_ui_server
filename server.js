const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const app = express();
const { Pool } = require('pg');
const bodyParser = require('body-parser');


//logging - winston
const winston = require("winston");
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'CA_Payment_Gateway',
  password: 'root',
  port: 5432, // Default PostgreSQL port
});

//send data to postgres
pool.connect()
  .then(() => console.log('Connected to PostgreSQL'))
  .catch(err => console.error('Error connecting to PostgreSQL', err));


// app.post('/api/insert', async (req, res) => {
//   const { data } = req.body;

//   try {
//     const result = await pool.query('INSERT INTO demo (name) VALUES ($1) RETURNING *', [data]);
//     res.json(result.rows[0]);
//   } catch (error) {
//     console.error('Error inserting data:', error);
//     res.status(500).json({ error: 'Internal server error' });
//   }
// });


const logger = winston.createLogger({

  level: "info",
  //standard log format
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(
      (info) => `${info.timestamp} ${info.level}: ${info.message}`
    )
  ),
  // Log to the console and a file
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "logs/app.log" }),
  ],
});

const multer = require('multer');
const upload = multer();

app.use(cors());
const port = 3001;
const unirest = require("unirest");


app.get('/authenticate', (req, res) => {
  const {username, password} = req.query;
  logger.info(`Received a ${req.method} request for ${req.url}`);
  const request = unirest("POST", "https://t4.automationedge.com/aeengine/rest/authenticate")
                  .query({username, password });
                  request.end(function (response) {
                    if (response.error) {
                        console.log(response.error)
                        logger.error(`${response.error.message} from t3 instance`);
                        res.status(401).send('Error occurred');
                      } else {
                        logger.info(`Session Token Received from t3 instance`);
                        res.status(200).json(response.body);
                      }
                  });

});

app.post('/upload', upload.array('files', 2), async (req, res) => {
  logger.info(`Received a ${req.method} request for to upload a file.`)
  const { files } = req;
  const sessionToken = req.body.sessionToken;
  const tenant_name = req.body.tenantName;
  const tenant_orgcode = req.body.tenantOrgCode;
  const mailId = req.body.mailId;

  console.log(sessionToken, tenant_name, tenant_orgcode);

  // Uploading file1 to the t3 server
  const response1 = await unirest.post("https://t4.automationedge.com/aeengine/rest/file/upload")
                                 .headers({ 'Content-Type': 'multipart/form-data', 'X-Session-Token': sessionToken })
                                 .query({'workflow_name': 'GSTR_2B_1', 'workflow_id': '4339'})
                                 .attach('file', files[0].buffer, { filename: files[0].originalname })
  
  const fileId1 = response1.body.fileId;

  //uploading file2 to the t3 server
  const response2 = await unirest.post("https://t4.automationedge.com/aeengine/rest/file/upload")
                                 .headers({ 'Content-Type': 'multipart/form-data', 'X-Session-Token': sessionToken })
                                 .query({'workflow_name': 'GSTR_2B_1', 'workflow_id': '4339'})
                                 .attach('file', files[1].buffer, { filename: files[1].originalname })
 
  const fileId2 = response2.body.fileId;

  console.log(fileId1, fileId2);

  // Executing workflow with input files
  await unirest.post("https://t4.automationedge.com/aeengine/rest/execute")
               .headers({ 'Content-Type': 'application/json', 'X-Session-Token': sessionToken })
               .query({'workflow_name': 'GSTR_2B_1', 'workflow_id': '4339'})
               .send(
                {"orgCode": tenant_orgcode,"workflowName":"GSTR_2B_1",
                "userId": tenant_name, "source":"Rest Test","responseMailSubject":"null",
                "params":[{"name": "Input_File", "value":fileId1, "type": "File"},
                {"name": "GST_File_Path", "value":fileId2, "type": "File"}, 
                {"name": "Destination_Address", "value": mailId, "type": "String"}]}
                )
               .end(function (response) {
                  if (response.error) {
                      logger.error(`Error in executing workflow`)
                      console.error(response.error);
                      res.status(500).send('Error occurred while executing worfkflow');
                    } else {
                      logger.info(`Automaiton request ID received ${response.body.automationRequestId}`)
                      res.status(200).json(response.body.automationRequestId);
                    }
                });
  });


app.get('/status', async (req, res) => {
  logger.info(`Received a ${req.method} request for ${req.url} to check status`);
  const {sessionToken, requestId} = req.query;
  
  let status = 'pending';
  let fileName = '';
  let fileValue = '';
  let request_id = '';
  let rowvalue='';
  let rowname='';
  // var row_count=0;
  // Checking Workflow status after every 3 seconds
  let counter = 0;

  while (status !== 'Complete' && status !== 'Failure') {
    console.log(sessionToken, requestId);
    const request = await unirest("GET", `https://t4.automationedge.com/aeengine/rest/workflowinstances/${requestId}`)
                            .headers({ 'Content-Type': 'application/json', 'X-Session-Token': sessionToken })
                            .end(function (response) {
                              console.log(response.body);
                                if (response.error) {
                                  console.log(response.error);
                                  res.status(500).send(response.error);
                                } else {
                                    status = response.body.status;
                                    if (response.body.workflowResponse) {
                                        fileName = JSON.parse(response.body.workflowResponse).outputParameters[1].name;
                                        if (fileName == 'Output File.xlsx'){
                                        fileValue = JSON.parse(response.body.workflowResponse).outputParameters[1].value;
                                        }
                                        else {
                                          fileValue = JSON.parse(response.body.workflowResponse).outputParameters[0].value;
                                        }
                                        //Row Count
                                        if(response.body.workflowResponse)
                                        {
                                           rowname=JSON.parse(response.body.workflowResponse).outputParameters[1].value;
                                           if(rowname=="value")
                                           {
                                            rowvalue=JSON.parse(response.body.workflowResponse).outputParameters[1].value;
                                           }
                                           else{
                                              rowvalue=JSON.parse(response.body.workflowResponse).outputParameters[0].value;
                                           }
                                        }
                                       
                                        }
                                        request_id = response.body.id;
                                  }
                                  if (status === 'New' && !response.body.agentName) {
                                            counter++;
                                            if (counter === 10) {
                                                status = 'no_agent';
                                                }
                                  } else {
                                            counter = 0;
                                  }
                                  
                            });
                            if (status === 'Complete' || status === 'Failure' || status === 'no_agent') {
                              break;
                            }
                            
                            await new Promise(resolve => setTimeout(resolve, 3000)); 
  };

      if (status === 'Complete') {
        console.log(fileValue, requestId);
        res.status(200).send({ status: 'Complete ! Please Check Your Mail', 
                               request_id: requestId,
                               file_id: fileValue,
                              row_count:rowvalue });
          } else if (status === 'Failure') {
        res.status(200).send({ status: 'Failure ! Please Try Again (Check Input Files)' });
        } else if (status === 'no_agent') {
          res.status(200).send({status: 'Contact the Administrator Agent Is Under Maintainance'});
        }

});

app.get('/download', async (req, res) => {
  const {sessionToken, requestId, fileId} = req.query;
  try {
    // Make the API request to the external download API
    const response = await axios({
      method: 'GET',
      url: 'https://t4.automationedge.com/aeengine/rest/file/download',
      params: { file_id: fileId, request_id: requestId }, // Set the fileID as a query parameter
      responseType: 'stream',
      headers: {
        'X-Session-Token': sessionToken, // Add the session token in the Authorization header
      },
    });
  
    // Get the file name from the response headers or set a default name
    const fileName = response.headers['content-disposition']
      ? response.headers['content-disposition'].split('filename=')[1]
      : 'downloaded_file.xlsx'; // Replace 'downloaded_file.ext' with the desired default name
  
    // Set the headers for the file download
    res.setHeader('Content-disposition', 'attachment; filename=' + fileName);
    res.setHeader('Content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); // Adjust the content-type based on your file type if needed
    
    // Stream the file to the client
    response.data.pipe(res);
  } catch (error) {
    console.error('Error downloading file:', error);
    res.status(500).send('Error downloading file');
  }
});

app.listen(port, () => {
  console.log(`Server app listening at http://192.168.4.131:${port}`);
});

