const { onRequest } = require("firebase-functions/v2/https");
const { GoogleGenerativeAI, HarmBlockThreshold, HarmCategory } = require("@google/generative-ai");
const sharp = require('sharp');
const os = require('os');
const path = require('path');
const fs = require('fs');
const Busboy = require('busboy');
const cors = require('cors');
const { initializeApp } = require('firebase-admin/app');
const { getAppCheck } = require('firebase-admin/app-check');

initializeApp();

const genAI = new GoogleGenerativeAI(process.env.API_KEY);

exports.analyzeImage = onRequest({cors:["https://jocodinghackathon.web.app"]}, async (req, res) => {
    // Verify the App Check token
    const appCheckToken = req.header('X-Firebase-AppCheck');
    if (!appCheckToken) {
        return res.status(401).json({ error: "Unauthorized: Missing App Check token" });
    }

    try {
        await getAppCheck().verifyToken(appCheckToken);
    } catch (error) {
        console.error("Error verifying App Check token:", error);
        return res.status(401).json({ error: "Unauthorized: Invalid App Check token" });
    }

    // Enable CORS using the 'cors' middleware
    cors({
        origin: 'https://jocodinghackathon.web.app',
        methods: ['POST'],
        credentials: true,
    })(req, res, async () => {
        if (req.method !== 'POST') {
            return res.status(405).end();
        }

        const busboy = Busboy({ headers: req.headers });
        let imageBuffer;
        let imageFileName;

        busboy.on('file', (fieldname, file, filename, encoding, mimetype) => {
            if (fieldname !== 'image') {
                file.resume();
                return;
            }

            const chunks = [];
            file.on('data', (chunk) => chunks.push(chunk));
            file.on('end', () => {
                imageBuffer = Buffer.concat(chunks);
                imageFileName = filename;
            });
        });

        busboy.on('finish', async () => {
            if (!imageBuffer) {
                return res.status(400).json({ error: "No image file uploaded" });
            }

            try {
                // Process the image using Sharp
                const processedImageBuffer = await sharp(imageBuffer)
                    .resize(512, 512)
                    .jpeg()
                    .toBuffer();
                
                // Create a temporary file path
                const tempFilePath = path.join(os.tmpdir(), `image_${Date.now()}.jpg`);

                // Save the processed image to the temporary file
                fs.writeFileSync(tempFilePath, processedImageBuffer);

                // Converts local file information to a GoogleGenerativeAI.Part object.
                function fileToGenerativePart(path, mimeType) {
                    return {
                        inlineData: {
                            data: Buffer.from(fs.readFileSync(path)).toString("base64"),
                            mimeType
                        },
                    };
                }
                
                // Turn images to Part objects
                const filePart1 = fileToGenerativePart(tempFilePath, "image/jpeg")
                const imageParts = [filePart1];

                // Prepare the prompt for Gemini
                const prompt = `Instruction
                Please provide a clear and straightforward score for the person's attractiveness on a scale from 0 to 100. Briefly describe the basis for your score and the characteristics of their face and appearance. The response must be in JSON format and should not include any additional commentary. Regardless of the image quality or other factors, always provide a score and description. Be respectful and focus on objective features without making assumptions about gender.

                Example
                response: {'score': 90, 'reason': 'This person has striking facial features, including high cheekbones and expressive eyes. Their overall appearance is very attractive.'}
                response: {'score': 95, 'reason': 'With a chiseled jawline, piercing eyes, and well-proportioned features, this individual has an exceptionally attractive appearance.'}
                response: {'score': 85, 'reason': 'The person has symmetrical features, clear skin, and a warm, genuine smile, contributing to their attractive look.'}
                response: {'score': 78, 'reason': 'Their slightly unconventional features, combined with confident posture and a unique style, create a distinctively attractive appearance.'}
                response: {'score': 92, 'reason': 'High cheekbones, well-defined facial structure, and captivating eyes give this person a remarkably attractive presence.'}
                response: {'score': 88, 'reason': 'A combination of well-groomed appearance, warm smile, and harmonious facial features makes this individual notably attractive.'}
                response: {'score': 82, 'reason': 'This person has a youthful appearance, bright eyes, and balanced facial proportions, contributing to their attractive look.'}
                response: {'score': 96, 'reason': 'Perfect facial symmetry, a radiant smile, and striking eyes make this individual exceptionally attractive.'}
                response: {'score': 75, 'reason': 'While their features are generally pleasing, minor asymmetries slightly detract from their overall attractiveness.'}
                response: {'score': 89, 'reason': 'A combination of well-defined facial features, expressive eyes, and a confident demeanor makes this person very attractive.'}
                response: {'score': 80, 'reason': 'Classic good looks enhanced by a neat hairstyle and a genuine smile make this individual attractive.'}
                response: {'score': 91, 'reason': 'The striking contrast between their hair color and complexion, along with strong facial features, contributes to their high attractiveness score.'}
                response: {'score': 65, 'reason': 'Their facial features are somewhat asymmetrical, and their skin has some blemishes, which slightly detract from their overall appearance.'}
                response: {'score': 60, 'reason': 'The person has less defined facial features, contributing to a more average appearance.'}
                response: {'score': 55, 'reason': 'Their facial features are plain and lack distinctiveness, giving them an ordinary look.'}
                response: {'score': 50, 'reason': 'The individual has a combination of minor facial asymmetries and a lack of striking features.'}
                response: {'score': 48, 'reason': 'Their facial proportions are slightly imbalanced, resulting in a less harmonious appearance.'}
                response: {'score': 45, 'reason': 'The person's face lacks strong definition and distinct features, making their appearance less memorable.'}
                response: {'score': 40, 'reason': 'Uneven skin tone and less defined facial structure affect their overall attractiveness.'}
                response: {'score': 35, 'reason': 'The person has several noticeable facial asymmetries and lacks standout features, leading to a lower score.'}
                response: {'score': 30, 'reason': 'Their face has noticeable imperfections and lacks symmetry, significantly affecting their attractiveness.'}
                response: {'score': 25, 'reason': 'The person's facial proportions are unbalanced, and they have noticeable skin blemishes, contributing to a lower attractiveness score.'}

                Example of unwanted response (Never respond like this)
                {"reason": "It is not possible to provide a score based on the provided image, as the subject's face is obscured. ", "score": 0}
                {"reason": "The image quality is too poor to assess the person's appearance accurately.", "score": 0}
                {"reason": "The subject's face is partially covered, making it impossible to provide a score.", "score": 0}
                {"reason": "The provided image is too dark to see the person's facial features clearly.", "score": 0}
                {"reason": "The angle of the image obscures important facial features, making it difficult to give a score.", "score": 0}
                {"reason": "The image resolution is too low to evaluate the person's appearance properly.", "score": 0}

                By clearly instructing the AI to avoid additional commentary and focus on a straightforward score and reason, the responses should become more direct and aligned with your requirements. Remember to maintain respect and avoid making assumptions about gender or personal characteristics beyond visible features.`;

                const model = genAI.getGenerativeModel({
                    model: 'gemini-1.5-flash',
                    safetySetting: [
                        { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                        { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
                        { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
                        { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
                        { category: HarmCategory.HARM_CATEGORY_UNSPECIFIED, threshold: HarmBlockThreshold.BLOCK_NONE },
                    ],
                    generationConfig: { responseMimeType: "application/json" }
                });

                const result = await model.generateContent([prompt, ...imageParts]);
                const response = await result.response;
                const text = response.text();
                
                // Clean up the temporary file
                fs.unlinkSync(tempFilePath);

                // Return the structured response
                res.status(200).json(JSON.parse(text));

            } catch (error) {
                console.error("Error analyzing image:", error);
                res.status(500).json({ error: "Internal Server Error" });
            }
        });

        busboy.end(req.rawBody);
    });
});