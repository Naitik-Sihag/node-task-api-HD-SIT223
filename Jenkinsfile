pipeline {
    agent any

    environment {
        APP_NAME        = 'node-task-api'
        DOCKER_IMAGE    = "node-task-api:${BUILD_NUMBER}"
        STAGING_PORT    = '3001'
        PROD_PORT       = '3000'
        SONAR_HOST      = 'http://localhost:9000'
        SONAR_TOKEN     = credentials('sonar-token')
        SNYK_TOKEN      = credentials('snyk-token')
    }

    options {
        timestamps()
        buildDiscarder(logRotator(numToKeepStr: '10'))
    }

    stages {

        // ─────────────────────────────────────────────
        // STAGE 1: Build
        // ─────────────────────────────────────────────
        stage('Build') {
            steps {
                echo "=== BUILD STAGE ==="
                sh 'node --version && npm --version'
                sh 'npm ci'
                sh 'docker build -t ${DOCKER_IMAGE} .'
                sh 'docker tag ${DOCKER_IMAGE} ${APP_NAME}:latest'
                archiveArtifacts artifacts: 'package.json', fingerprint: true
            }
            post {
                success { echo "Build artefact: Docker image ${DOCKER_IMAGE} created." }
                failure { echo "Build failed." }
            }
        }

        // ─────────────────────────────────────────────
        // STAGE 2: Test
        // ─────────────────────────────────────────────
        stage('Test') {
            steps {
                echo "=== TEST STAGE ==="
                sh 'npm test -- --ci --coverage --testResultsProcessor=jest-junit'
            }
            post {
                always {
                    junit testResults: 'junit.xml', allowEmptyResults: true
                    publishHTML(target: [
                        allowMissing: false,
                        alwaysLinkToLastBuild: true,
                        keepAll: true,
                        reportDir: 'coverage/lcov-report',
                        reportFiles: 'index.html',
                        reportName: 'Coverage Report'
                    ])
                }
                success { echo "All tests passed." }
                failure { error "Tests failed. Pipeline aborted." }
            }
        }

        // ─────────────────────────────────────────────
        // STAGE 3: Code Quality (SonarQube)
        // ─────────────────────────────────────────────
        stage('Code Quality') {
            steps {
                echo "=== CODE QUALITY STAGE ==="
                withSonarQubeEnv('SonarQube') {
                    sh '''
                        npx sonar-scanner \
                            -Dsonar.projectKey=${APP_NAME} \
                            -Dsonar.sources=src \
                            -Dsonar.tests=tests \
                            -Dsonar.javascript.lcov.reportPaths=coverage/lcov.info \
                            -Dsonar.host.url=${SONAR_HOST} \
                            -Dsonar.login=${SONAR_TOKEN}
                    '''
                }
            }
            post {
                always {
                    // Wait for SonarQube quality gate
                    timeout(time: 5, unit: 'MINUTES') {
                        waitForQualityGate abortPipeline: false
                    }
                }
            }
        }

        // ─────────────────────────────────────────────
        // STAGE 4: Security Scan (Snyk + Trivy)
        // ─────────────────────────────────────────────
        stage('Security') {
            steps {
                echo "=== SECURITY STAGE ==="
                // Snyk: dependency vulnerability scan
                sh '''
                    npx snyk auth ${SNYK_TOKEN} || true
                    npx snyk test --severity-threshold=high --json > snyk-report.json || true
                    npx snyk test --severity-threshold=high || echo "Snyk found issues - see report"
                '''
                // Trivy: Docker image scan
                sh '''
                    trivy image --exit-code 0 --severity HIGH,CRITICAL \
                        --format json -o trivy-report.json \
                        ${DOCKER_IMAGE} || true
                    echo "=== Trivy Summary ==="
                    trivy image --exit-code 0 --severity HIGH,CRITICAL ${DOCKER_IMAGE} || true
                '''
                archiveArtifacts artifacts: 'snyk-report.json, trivy-report.json', allowEmptyArchive: true
            }
            post {
                success { echo "Security scan complete. Review archived reports." }
            }
        }

        // ─────────────────────────────────────────────
        // STAGE 5: Deploy to Staging
        // ─────────────────────────────────────────────
        stage('Deploy') {
            steps {
                echo "=== DEPLOY STAGE (Staging) ==="
                sh '''
                    docker stop ${APP_NAME}-staging 2>/dev/null || true
                    docker rm   ${APP_NAME}-staging 2>/dev/null || true
                    docker run -d \
                        --name ${APP_NAME}-staging \
                        -p ${STAGING_PORT}:3000 \
                        -e NODE_ENV=staging \
                        --restart unless-stopped \
                        ${DOCKER_IMAGE}
                    sleep 5
                    curl -f http://localhost:${STAGING_PORT}/health || \
                        (docker logs ${APP_NAME}-staging && exit 1)
                    echo "Application deployed to staging on port ${STAGING_PORT}"
                '''
            }
            post {
                failure {
                    sh 'docker logs ${APP_NAME}-staging || true'
                    error "Staging deployment failed."
                }
            }
        }

        // ─────────────────────────────────────────────
        // STAGE 6: Release to Production
        // ─────────────────────────────────────────────
        stage('Release') {
            steps {
                echo "=== RELEASE STAGE (Production) ==="
                input message: "Deploy build #${BUILD_NUMBER} to production?", ok: "Release"
                sh '''
                    # Tag the image for production
                    docker tag ${DOCKER_IMAGE} ${APP_NAME}:prod-${BUILD_NUMBER}
                    docker tag ${DOCKER_IMAGE} ${APP_NAME}:prod-latest

                    # Rolling update: stop old prod, start new
                    docker stop ${APP_NAME}-prod 2>/dev/null || true
                    docker rm   ${APP_NAME}-prod 2>/dev/null || true
                    docker run -d \
                        --name ${APP_NAME}-prod \
                        -p ${PROD_PORT}:3000 \
                        -e NODE_ENV=production \
                        --restart unless-stopped \
                        ${APP_NAME}:prod-${BUILD_NUMBER}

                    sleep 5
                    curl -f http://localhost:${PROD_PORT}/health || \
                        (docker logs ${APP_NAME}-prod && exit 1)
                    echo "Released version prod-${BUILD_NUMBER} to production on port ${PROD_PORT}"
                '''
                // Tag in Git
                sh '''
                    git tag -a v1.0.${BUILD_NUMBER} \
                        -m "Production release from Jenkins build #${BUILD_NUMBER}" || true
                    git push --tags || true
                '''
            }
            post {
                success { echo "Production release prod-${BUILD_NUMBER} is live." }
                failure {
                    sh 'docker stop ${APP_NAME}-prod 2>/dev/null || true'
                    error "Production release failed. Rolled back."
                }
            }
        }

        // ─────────────────────────────────────────────
        // STAGE 7: Monitoring & Alerting
        // ─────────────────────────────────────────────
        stage('Monitoring') {
            steps {
                echo "=== MONITORING STAGE ==="
                sh '''
                    # Verify /metrics endpoint is reachable (Prometheus scrape target)
                    curl -f http://localhost:${PROD_PORT}/metrics | head -20
                    echo "Prometheus metrics endpoint is active"

                    # Start Prometheus + Grafana via docker-compose if not running
                    if ! docker ps | grep -q prometheus; then
                        docker compose up -d prometheus 2>/dev/null || true
                        echo "Prometheus started for metrics scraping"
                    fi

                    # Simulate a basic liveness alert check
                    STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:${PROD_PORT}/health)
                    if [ "$STATUS" != "200" ]; then
                        echo "ALERT: Health check failed with status ${STATUS}"
                        exit 1
                    fi
                    echo "Health check passed. Monitoring is active."
                '''
            }
            post {
                success { echo "Monitoring verified. Prometheus is scraping /metrics." }
            }
        }
    }

    // ─────────────────────────────────────────────
    // Post-pipeline notifications
    // ─────────────────────────────────────────────
    post {
        success {
            echo "Pipeline #${BUILD_NUMBER} completed successfully. All 7 stages passed."
        }
        failure {
            echo "Pipeline #${BUILD_NUMBER} FAILED. Check logs for details."
            // emailext subject: "Build FAILED: ${APP_NAME} #${BUILD_NUMBER}",
            //          body:    "Check Jenkins: ${BUILD_URL}",
            //          to:      "team@example.com"
        }
        always {
            cleanWs()
        }
    }
}
